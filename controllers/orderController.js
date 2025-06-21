const Order = require('../models/Order');
const Product = require('../models/Product'); // To update stock quantity
const User = require('../models/User'); // To update user's order history

exports.createOrder = async (req, res) => {
    console.log('--- Order Controller: Entering createOrder ---');
    console.log('Order Controller: req.body:', JSON.stringify(req.body, null, 2));
    console.log('Order Controller: req.user:', req.user ? { _id: req.user._id, email: req.user.email } : 'Not authenticated');

    try {
        const {
            orderItems,
            shippingAddress,
            paymentMethod,
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            // paymentDetails, // Frontend might send sensitive payment data here, handle carefully
        } = req.body;

        if (orderItems && orderItems.length === 0) {
            console.warn('Order Controller: No order items provided.');
            return res.status(400).json({ message: 'No order items' });
        }
        console.log(`Order Controller: Received ${orderItems.length} order items.`);

        // Validate product IDs and stock quantities (Crucial for inventory management)
        const productsInOrder = await Product.find({
            '_id': { $in: orderItems.map(x => x.productId) }
        });
        console.log(`Order Controller: Found ${productsInOrder.length} products in DB.`);

        const invalidItems = [];
        for (const item of orderItems) {
            const product = productsInOrder.find(p => p._id.toString() === item.productId.toString());
            if (!product) {
                invalidItems.push(`Product with ID ${item.productId} not found.`);
                console.error(`Order Controller: Product missing - ID ${item.productId}`);
            } else if (product.stockQuantity < item.quantity) {
                invalidItems.push(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
                console.error(`Order Controller: Insufficient stock for ${product.name} (ID: ${item.productId}). Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
            }
        }

        if (invalidItems.length > 0) {
            console.error('Order Controller: Order validation failed due to invalid items:', invalidItems);
            return res.status(400).json({ message: 'Order validation failed:', errors: invalidItems });
        }

        const newOrder = new Order({
            userId: req.user._id, // User ID comes from auth middleware
            orderItems,
            shippingAddress,
            paymentMethod,
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            isPaid: true, // Assuming successful mock payment
            paidAt: Date.now(),
            // paymentResult: { // Populate with actual payment gateway response
            //    id: paymentIntent.id,
            //    status: paymentIntent.status,
            //    update_time: paymentIntent.created,
            //    email_address: req.user.email
            // },
            status: 'Processing', 
        });
        console.log('Order Controller: New order object created:', JSON.stringify(newOrder, null, 2));

        const createdOrder = await newOrder.save();
        console.log('Order Controller: Order saved to DB successfully. Order ID:', createdOrder._id);

        // Decrement stock quantities for ordered products
        for (const item of orderItems) {
            await Product.findByIdAndUpdate(
                item.productId,
                { $inc: { stockQuantity: -item.quantity } },
                { new: true } // Return updated document
            );
        }

        // You might want to clear the user's cart here (if you have a Cart model/controller)
        await Cart.findOneAndDelete({ userId: req.user._id });

        res.status(201).json({ message: 'Order placed successfully', order: createdOrder });

    } catch (error) {
        console.error('Error creating order:', error);
        console.error('--- Order Controller: UNHANDLED ERROR during createOrder ---');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
         // Check for specific Mongoose validation errors
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            console.error('Mongoose Validation Error Details:', error.errors);
            return res.status(400).json({ message: 'Order validation failed', errors: messages });
        }

        // Check for CastError (e.g., invalid ObjectId)
        if (error.name === 'CastError') {
            console.error(`CastError on path '${error.path}' with value '${error.value}'`);
            return res.status(400).json({ message: `Invalid ID format for ${error.path}`, details: error.message });
        }
        
        res.status(500).json({ message: 'Failed to create order', details: error.message });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user._id })
            .populate('userId', 'name email') // Populate user details
            .populate('orderItems.productId', 'name slug images price'); // Populate product details for order items
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Failed to fetch user orders', details: error.message });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('userId', 'name email')
            .populate('orderItems.productId', 'name slug images price');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Allow user to view their own order, or admin to view any order
        if (order.userId._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
             // Assuming req.user has an isAdmin field from auth middleware
            return res.status(403).json({ message: 'Not authorized to view this order' });
        }

        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching order by ID:', error);
        res.status(500).json({ message: 'Failed to fetch order', details: error.message });
    }
};

exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate('userId', 'id name email') // Populate user info for admin view
            .sort({ createdAt: -1 }); // Latest orders first
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching all orders:', error);
        res.status(500).json({ message: 'Failed to fetch all orders', details: error.message });
    }
};

exports.updateOrderToDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.isDelivered = true;
        order.deliveredAt = Date.now();
        order.status = 'Delivered'; // Update status

        const updatedOrder = await order.save();
        res.status(200).json({ message: 'Order delivered successfully!', order: updatedOrder });
    } catch (error) {
        console.error('Error updating order to delivered:', error);
        res.status(500).json({ message: 'Failed to update order status', details: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status provided.' });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.status = status;
        if (status === 'Delivered' && !order.isDelivered) {
            order.isDelivered = true;
            order.deliveredAt = Date.now();
        } else if (status !== 'Delivered' && order.isDelivered) {
            // If status changes from Delivered to something else, reset delivered flags
            order.isDelivered = false;
            order.deliveredAt = undefined;
        }

        const updatedOrder = await order.save();
        res.status(200).json({ message: `Order status updated to ${status}!`, order: updatedOrder });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Failed to update order status', details: error.message });
    }
};

exports.deleteOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        await order.deleteOne(); // Use deleteOne for Mongoose 6+
        res.status(200).json({ message: 'Order removed' });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ message: 'Failed to delete order', details: error.message });
    }
};
