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
        } = req.body;

        // 1. Basic validation for order items
        if (!orderItems || orderItems.length === 0) {
            console.warn('Order Controller: No order items provided.');
            return res.status(400).json({ message: 'No order items' });
        }
        console.log(`Order Controller: Received ${orderItems.length} order items.`);

        // Extract product IDs for the database query, defensively handling non-string/null productIds
        const productIds = orderItems
            .map(item => {
                // Ensure productId is a string before pushing to array for query
                if (typeof item.productId === 'string' && mongoose.Types.ObjectId.isValid(item.productId)) {
                    return item.productId;
                }
                // If it's an object with _id, try to use that
                if (item.productId && typeof item.productId._id === 'string' && mongoose.Types.ObjectId.isValid(item.productId._id)) {
                    return item.productId._id;
                }
                // Log and return null for invalid productIds to filter out later
                console.warn(`Order Controller: Invalid productId format found:`, item.productId);
                return null;
            })
            .filter(id => id !== null); // Filter out any nulls

        if (productIds.length === 0 && orderItems.length > 0) {
            console.error('Order Controller: No valid product IDs found in order items.');
            return res.status(400).json({ message: 'No valid product IDs in order items.' });
        }
        console.log('Order Controller: Product IDs to check:', productIds);


        const productsInOrder = await Product.find({
            '_id': { $in: productIds }
        });
        console.log(`Order Controller: Found ${productsInOrder.length} products in DB.`);


        const invalidItems = [];
        for (const item of orderItems) {
            // Ensure item.productId is consistently handled as a string ID here
            const currentProductId = item.productId && typeof item.productId === 'object' && item.productId._id
                                    ? item.productId._id // If it's an object, get _id
                                    : item.productId; // Otherwise, assume it's already the ID string

            if (!currentProductId || !mongoose.Types.ObjectId.isValid(currentProductId)) {
                 invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${item.productId}`);
                 console.error(`Order Controller: Invalid product ID format found for item ${item.name}. ID: ${item.productId}`);
                 continue; // Skip to next item
            }

            const product = productsInOrder.find(p => p._id.toString() === currentProductId.toString());
            if (!product) {
                invalidItems.push(`Product with ID ${currentProductId} not found.`);
                console.error(`Order Controller: Product missing - ID ${currentProductId}`);
            } else if (product.stockQuantity < item.quantity) {
                invalidItems.push(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
                console.error(`Order Controller: Insufficient stock for ${product.name} (ID: ${currentProductId}). Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
            }
        }

        if (invalidItems.length > 0) {
            console.error('Order Controller: Order validation failed due to invalid items:', invalidItems);
            return res.status(400).json({ message: 'Order validation failed:', errors: invalidItems });
        }
        console.log('Order Controller: Product and stock validation passed.');

        // Reconstruct orderItems with correct productId if needed (ensure it's just the ID)
        const finalOrderItems = orderItems.map(item => ({
            productId: item.productId && typeof item.productId === 'object' && item.productId._id
                       ? item.productId._id // Extract _id if it's an object
                       : item.productId, // Otherwise, assume it's already a string ID
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            image: item.image
        }));


        const newOrder = new Order({
            userId: req.user._id,
            orderItems: finalOrderItems, // Use the cleaned order items
            shippingAddress,
            paymentMethod,
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            isPaid: true,
            paidAt: Date.now(),
            status: 'Processing',
        });
        console.log('Order Controller: New order object created (before save):', JSON.stringify(newOrder, null, 2));


        const createdOrder = await newOrder.save();
        console.log('Order Controller: Order saved to DB successfully. Order ID:', createdOrder._id);

        for (const item of finalOrderItems) { // Use finalOrderItems for stock update
            const product = productsInOrder.find(p => p._id.toString() === item.productId.toString());
            if (product) {
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stockQuantity: -item.quantity } },
                    { new: true, runValidators: true }
                );
                console.log(`Order Controller: Decremented stock for product ${item.name} by ${item.quantity}.`);
            }
        }

        res.status(201).json({ message: 'Order placed successfully', order: createdOrder });

    } catch (error) {
        console.error('--- Order Controller: UNHANDLED ERROR during createOrder ---');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            console.error('Mongoose Validation Error Details:', error.errors);
            return res.status(400).json({ message: 'Order validation failed', errors: messages });
        }

        if (error.name === 'CastError') {
            console.error(`CastError on path '${error.path}' with value '${error.value}'`);
            return res.status(400).json({ message: `Invalid ID format for ${error.path}`, details: error.message });
        }

        res.status(500).json({ message: 'An internal server error occurred', details: error.message });
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
