const Order = require('../models/Order');
const Product = require('../models/Product'); // To update stock quantity
const User = require('../models/User'); 
const Counter = require('../models/Counter'); 
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT), // Ensure port is a number
    secure: process.env.EMAIL_SECURE === 'true', // Ensure secure is a boolean
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

// Helper to get admin emails from .env (comma-separated)
function getAdminEmails() {
    const emails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
    return emails.split(',').map(e => e.trim()).filter(Boolean);
}

// Helper to send order notification emails (with optional cc/bcc)
async function sendOrderNotification({ to, subject, html, cc, bcc }) {
    await transporter.sendMail({
        to,
        cc,
        bcc,
        from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
        subject,
        html
    });
}

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
function formatOrderNumber(sequenceNumber) {
    const paddedSequence = String(sequenceNumber).padStart(9, '0');
    return `MGV${paddedSequence}`;
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
            paymentResult,
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
            paymentResult: paymentResult || {},
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            isPaid: paymentMethod === 'Credit/Debit Card',
            paidAt: paymentMethod === 'Credit/Debit Card' ? Date.now() : null,
            status: paymentMethod === 'Credit/Debit Card' ? 'Processing' : 'Pending',
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

        // --- EMAIL NOTIFICATIONS ---
        try {
            // Fetch user details for email
            const user = await User.findById(req.user._id);
            const adminEmails = getAdminEmails();
            const orderDetailsHtml = `
            <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">
                
                <!-- Header Section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures</h1>
                </div>

                <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">
                    <h2>Hi ${user.name}</h2>
                    <p>Thank you for placing your order with Marshall Global Ventures with order number: ${createdOrder.orderNumber}</p>
                    <p>We have received your request and are currently processing it.</p>
                    <br />
                    <h3>Order Summary</h3>
                    <p><strong>Order Number:</strong> ${createdOrder.orderNumber}</p>
                    <p><strong>Status:</strong> ${createdOrder.status}</p>
                    <p><strong>Total Amount:</strong> ₦${createdOrder.totalPrice}</p>
                    <p><strong>Payment Method:</strong> ₦${createdOrder.paymentMethod}</p>
                    <p><strong>Payment Status:</strong> ${createdOrder.isPaid ? 'Paid' : 'Not Paid'}</p>
                    <br />
                    <h3>Items Ordered</h3>
                    <ul>
                        ${createdOrder.orderItems.map(item => `<li>${item.name} x ${item.quantity} (₦${item.price})</li>`).join('')}
                    </ul>
                    <br />
                    <h3>Shipping Details</h3>
                    <p>${createdOrder.shippingAddress.address1}, ${createdOrder.shippingAddress.city}, ${createdOrder.shippingAddress.zipCode}, ${createdOrder.shippingAddress.country}</p>
                    <p>We will notify you once your order is shipped. For mean time, you can track your order status on <a href="mgv-tech.com/app/trackorder">our website</a>.</p>
                    <p>Thank you for shopping with us!</p>
                    <p>Best regards,</p>
                    <p>Marshall Global Ventures Team - <a href="https://mgv-tech.com">Visit our website for more details.</a></p>
                </div>

                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
            </div>
            `;

            const adminOrderNotificationHtml = `
              <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">
                
                <!-- Header Section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures</h1>
                </div>

                <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">
                  <h2 style="font-size:1.8rem;color:#00B9F1;margin-bottom:16px;">Hi Marshall Global Ventures, New Order Placed</h2>
                  <p style="font-size:1.1rem;color:#222;margin-bottom:16px;">A new order has been placed by <strong>${user.name || user.email}</strong> (${user.email}).</p>
                  <p style="color:#222;line-height:1.5;margin-bottom:24px;">Order Number: <strong>${createdOrder.orderNumber}</strong></p>
                  
                  <h3>Order Summary</h3>
                  <p><strong>Order Number:</strong> ${createdOrder.orderNumber}</p>
                  <p><strong>Status:</strong> ${createdOrder.status}</p>
                  <p><strong>Total Amount:</strong> ₦${createdOrder.totalPrice}</p>
                  <p><strong>Payment Method:</strong> ${createdOrder.paymentMethod}</p>
                  <p><strong>Payment Status:</strong> ${createdOrder.isPaid ? 'Paid' : 'Not Paid'}</p>
                  <br />
                  <h3>Items Ordered</h3>
                  <ul>
                    ${createdOrder.orderItems.map(item => `<li>${item.name} x ${item.quantity} (₦${item.price})</li>`).join('')}
                  </ul>
                  <br />
                  <h3>Shipping Details</h3>
                  <p>${createdOrder.shippingAddress.address1}, ${createdOrder.shippingAddress.city}, ${createdOrder.shippingAddress.zipCode}, ${createdOrder.shippingAddress.country}</p>

                  <p style="margin-top:32px;color:#888;font-size:0.95rem;line-height:1.5;">Please, login to your dashboard to review the order details and proceed with processing. You can also update the order status so the customer is aware of the update.</p>
                  <p style="margin-top:16px;color:#888;font-size:0.95rem;line-height:1.5;">Marshall Global Ventures</p>
                </div>
                
                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
              </div>
            `;

            // Email to customer
            await sendOrderNotification({
                to: user.email,
                from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
                subject: `Your Order Confirmation - ${createdOrder.orderNumber} | Marshall Global Ventures`,
                html: orderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `New Order Placed - ${createdOrder.orderNumber}`,
                    html: adminOrderNotificationHtml
                });
            }
        } catch (emailErr) {
            console.error('Order email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

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
        
        // --- EMAIL NOTIFICATIONS ---
        try {
            const user = await User.findById(order.userId);
            const adminEmails = getAdminEmails();
            const orderDetailsHtml = `
            <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">

                <!-- Header Section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures!</h1>
                </div>

                 <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">
                    <h2>Order Delivered - ${order.orderNumber}</h2>
                    <p>Order for ${user.name} (${user.email}) has been marked as <strong>Delivered</strong>.</p>
                    <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                    <p><strong>Status:</strong> Delivered</p>
                    <p><strong>Total:</strong> ₦${order.totalPrice}</p>
                </div>

                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
            </div>
            `;
            const adminOrderDetailsHtml = `
            <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">

                <!-- Header section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures!</h1>
                </div>

                <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">                    
                    <p style="font-size:1.1rem;margin-bottom:16px;">Dear Marshall Global Ventures Team,</p>

                    <h2 style="font-size:1.8rem;color:#00B9F1;margin-bottom:16px;">Order Status Update: Delivered!</h2>

                    <p style="font-size:1.1rem;margin-bottom:16px;">
                        This notification confirms that Order Number <strong>${order.orderNumber}</strong> has been successfully marked as <strong>Delivered</strong> in our system.
                    </p>

                    <h3 style="font-size:1.3rem;color:#333;margin-top:24px;margin-bottom:12px;">Order Details Summary:</h3>
                    <ul style="list-style:none;padding:0;margin:0;">
                        <li style="margin-bottom:8px;"><strong>Order Number:</strong> <span style="color:#00B9F1;">${order.orderNumber}</span></li>
                        <li style="margin-bottom:8px;"><strong>Customer:</strong> ${user.name || user.email} (${user.email})</li>
                        <li style="margin-bottom:8px;"><strong>Current Status:</strong> <span style="color:#28a745;font-weight:bold;">Delivered</span></li>
                        <li style="margin-bottom:8px;"><strong>Total Amount:</strong> ₦${order.totalPrice ? order.totalPrice.toFixed(2) : '0.00'}</li>
                    </ul>

                    <p style="margin-top:24px;margin-bottom:24px;">
                        Please log in to the admin dashboard to review the full order details and take any necessary follow-up actions.
                    </p>
                    <a href="${process.env.FRONTEND_URL || 'https://mgv-tech.com'}/app/vieworderdetails/${order._id}" style="display:inline-block;margin:18px 0 0 0;padding:12px 28px;background:#00B9F1;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:1rem;box-shadow:0 4px 8px rgba(0, 185, 241, 0.2);">View Order in Admin Panel</a>

                    <p style="margin-top:32px;color:#888;font-size:0.95rem;line-height:1.5;">Best regards,<br/>The Marshall Global Ventures System</p>
                </div>

                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
            </div>
            `;
            // Email to customer
            await sendOrderNotification({
                to: user.email,
                from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
                subject: `Your Order Has Been Delivered - ${order.orderNumber}`,
                html: orderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `Order Delivered - ${order.orderNumber}`,
                    html: adminOrderDetailsHtml
                });
            }
        } catch (emailErr) {
            console.error('Order delivered email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

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
        
        // --- EMAIL NOTIFICATIONS ---
        try {
            const user = await User.findById(order.userId);
            const adminEmails = getAdminEmails();
            const orderDetailsHtml = `
            <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">

                <!-- Header section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures!</h1>
                </div>

                <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">
                    <h3>Hi ${user.name}</h3>
                    <p>We are happy to let you know that the status of your order ${order.orderNumber} has been updated.
                    <br />
                    <h2>Order Details</h2>
                    <p><strong>Customer:</strong> ${user.name}</p>
                    <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                    <p><strong>Current Status:</strong> ${order.status}</p>
                    <p><strong>Order Total:</strong> ₦${order.totalPrice}</p>
                    <p>Our team is now preparing your items for shipment. Once your order is dispatched, we will send you another update with tracking details.</p>
                    <p>If you have any questions or need assistance, feel free to reach out to us.</p>
                    <br />
                    <p><strong>Thank you for shopping with Marshall Global Ventures.</strong></p>
                    <p>We appreciate your trust and look forward to serving you again.</p>
                    <p>Warm regards,</p>
                    <p>Marshall Global Ventures Team - <a href="https://mgv-tech.com/app/trackorder">Track your order status here.</a></p>
                </div>

                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
            </div>
            `;

            const AdminOrderDetailsHtml = `
            <div style="max-width:580px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:'Inter',sans-serif;">

                <!-- Header section -->
                <div style="background:#00B9F1;padding:24px 0;text-align:center;">
                    <img src="https://mgv-tech.com/mgvfavicon.png" alt="Marshall Global Ventures Logo" style="height:60px;margin-bottom:8px;display:inline-block;" />
                    <h1 style="color:#fff;margin:0;font-size:2.2rem;font-weight:700;line-height:1.2;">Marshall Global Ventures!</h1>
                </div>

                <!-- Body Section -->
                <div style="padding:32px 24px 24px 24px;">
                    <h3>Hi Marshall Glabal Ventures Team,</h3>
                    <p>This is to let you know that the order ${order.orderNumber} has been updated.
                    <br />
                    <h2>Order Details</h2>
                    <p><strong>Customer:</strong> ${user.name}</p>
                    <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                    <p><strong>Current Status:</strong> ${order.status}</p>
                    <p><strong>Order Total:</strong> ₦${order.totalPrice}</p>
                </div>
                
                <!-- Footer Section -->
                <div style="background:#f0f0f0;padding:24px;text-align:center;color:#666;font-size:0.85rem;line-height:1.6;border-top:1px solid #e5e5e5;">
                    <p style="margin:0 0 8px 0;">&copy; 2025 Marshall Global Ventures. All rights reserved.</p>
                    <p style="margin:0 0 8px 0;">
                        123 Ikorodu Road, Lagos, Nigeria
                    </p>
                    <p style="margin:0 0 16px 0;">
                        Email: <a href="mailto:info@mgv-tech.com" style="color:#00B9F1;text-decoration:none;">info@mgv-tech.com</a> | Phone: <a href="tel:+2348103069432" style="color:#00B9F1;text-decoration:none;">(+234) 08103069432</a>
                    </p>
                    <div style="margin-top:10px;">
                        <a href="https://linkedin.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">LinkedIn</a> |
                        <a href="https://instagram.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Instagram</a> |
                        <a href="https://tiktok.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">TikTok</a> |
                        <a href="https://facebook.com" style="color:#00B9F1;text-decoration:none;margin:0 8px;">Facebook</a>
                    </div>
                </div>
            </div>
            `;
            // Email to customer
            await sendOrderNotification({
                to: user.email,
                from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
                subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                html: orderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                    html: AdminOrderDetailsHtml
                });
            }
        } catch (emailErr) {
            console.error('Order status update email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

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

exports.getPublicOrderStatus = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const order = await Order.findOne({ orderNumber: orderNumber.toUpperCase() });

        if (!order) {
            return res.status(404).json({ message: 'Order not found with this number.' });
        }

        // IMPORTANT: Only return public, non-sensitive information
        res.status(200).json({
            orderNumber: order.orderNumber,
            status: order.status,
            isPaid: order.isPaid,
            totalPrice: order.totalPrice,
            createdAt: order.createdAt,
            // Add any other non-sensitive fields you deem necessary for public tracking
            // DO NOT include: userId, shippingAddress, orderItems, paymentResult (sensitive parts)
        });

    } catch (error) {
        console.error('Error fetching public order status:', error);
        res.status(500).json({ message: 'Failed to retrieve order status.', details: error.message });
    }
};
