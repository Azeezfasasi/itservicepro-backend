const Order = require('../models/Order');
const Product = require('../models/Product'); // To update stock quantity
const User = require('../models/User'); 
const Counter = require('../models/Counter'); 
const mongoose = require('mongoose');

// Helper function to get and increment sequence value
async function getNextSequenceValue(sequenceName) {
    const counter = await Counter.findOneAndUpdate(
        { _id: sequenceName },
        { $inc: { seq: 1 } }, // Increment the sequence number
        { new: true, upsert: true, setDefaultsOnInsert: true } // Return the new document, create if not exists
    );
    return counter.seq;
}

// Helper function to format the order number
// Example: ORD-YYYYMMDD-000001
function formatOrderNumber(sequenceNumber) {
    // const now = new Date();
    // const year = now.getFullYear();
    // const month = (now.getMonth() + 1).toString().padStart(2, '0');
    // const day = now.getDate().toString().padStart(2, '0');
    const paddedSequence = String(sequenceNumber).padStart(9, '0'); // Pad with leading zeros to 7 digits
    // return `ORD-${year}${month}${day}-${paddedSequence}`;
    return `ITS${paddedSequence}`;
    // Or simply: return `ORD-${paddedSequence}`; if you prefer shorter numbers
}

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

        // Extract and validate product IDs for the database query
        const productIds = orderItems
            .map(item => {
                let pId;
                if (typeof item.productId === 'string' && mongoose.Types.ObjectId.isValid(item.productId)) {
                    pId = item.productId;
                } else if (item.productId && typeof item.productId === 'object' && item.productId._id && mongoose.Types.ObjectId.isValid(item.productId._id)) {
                    pId = item.productId._id.toString();
                }
                if (!pId) {
                    console.warn(`Order Controller: Invalid productId format found in orderItems. Item:`, item);
                }
                return pId;
            })
            .filter(id => id !== undefined && id !== null);

        if (productIds.length === 0) {
            console.error('Order Controller: No valid product IDs found in order items after filtering.');
            return res.status(400).json({ message: 'No valid product IDs in order items after validation.' });
        }
        console.log('Order Controller: Product IDs to check:', productIds);


        const productsInOrder = await Product.find({
            '_id': { $in: productIds }
        });
        console.log(`Order Controller: Found ${productsInOrder.length} products in DB for provided IDs.`);

        const invalidItems = [];
        for (const item of orderItems) {
            let currentProductId;

            if (typeof item.productId === 'string') {
                currentProductId = item.productId;
            } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
                currentProductId = item.productId._id.toString();
            } else {
                invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${item.productId}`);
                console.error(`Order Controller: Invalid product ID format found for item ${item.name}. ID: ${item.productId}`);
                continue;
            }

            if (!mongoose.Types.ObjectId.isValid(currentProductId)) {
                 invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${currentProductId}`);
                 console.error(`Order Controller: Product ID is not a valid ObjectId: ${currentProductId}`);
                 continue;
            }

            const product = productsInOrder.find(p => p._id.toString() === currentProductId);
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

        const finalOrderItems = orderItems.map(item => {
            let pId;
            if (typeof item.productId === 'string') {
                pId = item.productId;
            } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
                pId = item.productId._id.toString();
            } else {
                return null;
            }

            if (!mongoose.Types.ObjectId.isValid(pId)) {
                return null;
            }

            return {
                productId: pId,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                image: item.image
            };
        }).filter(item => item !== null);

        if (finalOrderItems.length === 0) {
            console.error('Order Controller: All order items were invalid or filtered out.');
            return res.status(400).json({ message: 'All items in your order were invalid.' });
        }
        console.log('Order Controller: Final order items after cleanup:', JSON.stringify(finalOrderItems, null, 2));


        // --- GENERATE ORDER NUMBER HERE ---
        const sequenceNumber = await getNextSequenceValue('orderId'); // 'orderId' is the name of your sequence
        const orderNumber = formatOrderNumber(sequenceNumber);
        console.log('Order Controller: Generated Order Number:', orderNumber);
        // --- END GENERATION ---


        const newOrder = new Order({
            userId: req.user._id,
            orderNumber: orderNumber,
            orderItems: finalOrderItems,
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

        for (const item of finalOrderItems) {
            const product = productsInOrder.find(p => p._id.toString() === item.productId.toString());
            if (product) {
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stockQuantity: -item.quantity } },
                    { new: true, runValidators: true }
                );
                console.log(`Order Controller: Decremented stock for product ${item.name} (ID: ${item.productId}) by ${item.quantity}.`);
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
        if (error.code === 11000) { // Handle duplicate key error for orderNumber in case of race condition
            return res.status(400).json({ message: 'Failed to create order due to duplicate order number. Please try again.', details: error.message });
        }
        res.status(500).json({ message: 'An internal server error occurred', details: error.message });
    }
};

// exports.createOrder = async (req, res) => {
//     console.log('--- Order Controller: Entering createOrder ---');
//     console.log('Order Controller: req.body:', JSON.stringify(req.body, null, 2));
//     console.log('Order Controller: req.user:', req.user ? { _id: req.user._id, email: req.user.email } : 'Not authenticated');

//     try {
//         const {
//             orderItems,
//             shippingAddress,
//             paymentMethod,
//             itemsPrice,
//             taxPrice,
//             shippingPrice,
//             totalPrice,
//         } = req.body;

//         // 1. Basic validation for order items
//         if (!orderItems || orderItems.length === 0) {
//             console.warn('Order Controller: No order items provided.');
//             return res.status(400).json({ message: 'No order items' });
//         }
//         console.log(`Order Controller: Received ${orderItems.length} order items.`);

//         // Extract product IDs for the database query, defensively handling non-string/null productIds
//         const productIds = orderItems
//             .map(item => {
//                 // Ensure productId is a string before pushing to array for query
//                 // It's crucial that `item.productId` itself should already be the string ID from the cart.
//                 // If the cart has full product objects, the frontend mapping needs to ensure it's `item.productId._id`.
//                 if (typeof item.productId === 'string' && mongoose.Types.ObjectId.isValid(item.productId)) {
//                     return item.productId;
//                 }
//                 // Fallback for cases where frontend might send the whole product object
//                 if (item.productId && typeof item.productId === 'object' && item.productId._id && mongoose.Types.ObjectId.isValid(item.productId._id)) {
//                     return item.productId._id.toString(); // Ensure it's a string
//                 }
//                 // Log and return null for invalid productIds to filter out later
//                 console.warn(`Order Controller: Invalid productId format found in orderItems. Skipping item:`, item.productId);
//                 return null; // Will be filtered out
//             })
//             .filter(id => id !== null); // Filter out any nulls

//         if (productIds.length === 0 && orderItems.length > 0) {
//             console.error('Order Controller: No valid product IDs found in order items after filtering.');
//             return res.status(400).json({ message: 'No valid product IDs in order items after validation.' });
//         }
//         console.log('Order Controller: Product IDs to check:', productIds);


//         const productsInOrder = await Product.find({
//             '_id': { $in: productIds }
//         });
//         console.log(`Order Controller: Found ${productsInOrder.length} products in DB for provided IDs.`);


//         const invalidItems = [];
//         for (const item of orderItems) {
//             let currentProductId;

//             // Determine the actual productId string for validation
//             if (typeof item.productId === 'string') {
//                 currentProductId = item.productId;
//             } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
//                 currentProductId = item.productId._id.toString();
//             } else {
//                 // This branch handles `productId: null` or malformed objects without _id
//                 invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${item.productId}`);
//                 console.error(`Order Controller: Invalid product ID format found for item ${item.name}. ID: ${item.productId}`);
//                 continue; // Skip to next item
//             }

//             if (!mongoose.Types.ObjectId.isValid(currentProductId)) {
//                  invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${currentProductId}`);
//                  console.error(`Order Controller: Product ID is not a valid ObjectId: ${currentProductId}`);
//                  continue;
//             }

//             const product = productsInOrder.find(p => p._id.toString() === currentProductId); // currentProductId is already string
//             if (!product) {
//                 invalidItems.push(`Product with ID ${currentProductId} not found.`);
//                 console.error(`Order Controller: Product missing - ID ${currentProductId}`);
//             } else if (product.stockQuantity < item.quantity) {
//                 invalidItems.push(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
//                 console.error(`Order Controller: Insufficient stock for ${product.name} (ID: ${currentProductId}). Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
//             }
//         }

//         if (invalidItems.length > 0) {
//             console.error('Order Controller: Order validation failed due to invalid items:', invalidItems);
//             return res.status(400).json({ message: 'Order validation failed:', errors: invalidItems });
//         }
//         console.log('Order Controller: Product and stock validation passed.');

//         // Reconstruct orderItems with correct productId if needed (ensure it's just the ID)
//         const finalOrderItems = orderItems.map(item => {
//             let pId;
//             if (typeof item.productId === 'string') {
//                 pId = item.productId;
//             } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
//                 pId = item.productId._id.toString(); // Ensure it's a string
//             } else {
//                 // This case should ideally be caught by initial validation, but for safety
//                 console.warn(`Order Controller: Attempting to map order item with invalid productId (will be excluded):`, item.productId);
//                 return null; // This will be filtered out next
//             }

//             if (!mongoose.Types.ObjectId.isValid(pId)) {
//                 console.warn(`Order Controller: Mapped product ID is not a valid ObjectId (will be excluded):`, pId);
//                 return null;
//             }

//             return {
//                 productId: pId,
//                 name: item.name,
//                 quantity: item.quantity,
//                 price: item.price,
//                 image: item.image
//             };
//         }).filter(item => item !== null); // Filter out any items that couldn't get a valid productId

//         if (finalOrderItems.length === 0) {
//             console.error('Order Controller: All order items were invalid or filtered out.');
//             return res.status(400).json({ message: 'All items in your order were invalid.' });
//         }
//         console.log('Order Controller: Final order items after cleanup:', JSON.stringify(finalOrderItems, null, 2));


//         const newOrder = new Order({
//             userId: req.user._id,
//             orderItems: finalOrderItems, // Use the cleaned and validated order items
//             shippingAddress,
//             paymentMethod,
//             itemsPrice,
//             taxPrice,
//             shippingPrice,
//             totalPrice,
//             isPaid: true,
//             paidAt: Date.now(),
//             status: 'Processing',
//         });
//         console.log('Order Controller: New order object created (before save):', JSON.stringify(newOrder, null, 2));


//         const createdOrder = await newOrder.save();
//         console.log('Order Controller: Order saved to DB successfully. Order ID:', createdOrder._id);

//         for (const item of finalOrderItems) { // Use finalOrderItems for stock update
//             const product = productsInOrder.find(p => p._id.toString() === item.productId.toString());
//             if (product) { // Ensure product exists before updating stock
//                 await Product.findByIdAndUpdate(
//                     item.productId,
//                     { $inc: { stockQuantity: -item.quantity } },
//                     { new: true, runValidators: true }
//                 );
//                 console.log(`Order Controller: Decremented stock for product ${item.name} (ID: ${item.productId}) by ${item.quantity}.`);
//             }
//         }

//         res.status(201).json({ message: 'Order placed successfully', order: createdOrder });

//     } catch (error) {
//         console.error('--- Order Controller: UNHANDLED ERROR during createOrder ---');
//         console.error('Error name:', error.name);
//         console.error('Error message:', error.message);
//         console.error('Error stack:', error.stack);

//         if (error.name === 'ValidationError') {
//             const messages = Object.values(error.errors).map(val => val.message);
//             console.error('Mongoose Validation Error Details:', error.errors);
//             return res.status(400).json({ message: 'Order validation failed', errors: messages });
//         }

//         if (error.name === 'CastError') {
//             console.error(`CastError on path '${error.path}' with value '${error.value}'`);
//             return res.status(400).json({ message: `Invalid ID format for ${error.path}`, details: error.message });
//         }

//         res.status(500).json({ message: 'An internal server error occurred', details: error.message });
//     }
// };

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
