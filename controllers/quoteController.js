const QuoteRequest = require('../models/QuoteRequest');
const User = require('../models/User');
const nodemailer = require('nodemailer'); // Re-added nodemailer import
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

exports.sendQuoteRequest = async (req, res) => {
  const { name, email, phone, service, message } = req.body;
  if (!name || !email || !phone || !service || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Save to MongoDB
    const quote = new QuoteRequest({ name, email, phone, service, message });
    await quote.save();

    // Send email to admins
    const adminEmails = getAdminEmails();
    // CHANGED: Use transporter.sendMail directly
    await transporter.sendMail({
      from: `"${quote.name}" <${quote.email}>`,
      to: adminEmails[0] || process.env.RECEIVER_EMAIL,
      cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
      subject: `Quote Request from ${quote.name} on Marshall Global Ventures`,
      html: `<p><strong>Hello Admin,</strong></p><p>A new quote request has just been submitted through the Marshall Global Ventures website. Please review the details below:</p><p><strong>Service Requested:</strong> ${quote.service}</p><p><strong>Message:</strong> ${quote.message}</p><p><strong>From:</strong> ${quote.name} (${quote.email}) (${quote.phone})</p><br /><p>Please <a href="https://mgv-tech.com/login">log in</a> to your admin dashboard to follow up or assign this request to a team member.</p>`
    });

    // Send confirmation email to customer
    // CHANGED: Use transporter.sendMail directly
    await transporter.sendMail({
      to: quote.email,
      from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
      from: process.env.EMAIL_USER, // Using GMAIL_USER as the sender for confirmation
      subject: 'We Received Your Quote Request on Marshall Global Ventures',
      html: `<h2>Thank you for submitting a quote request through the IT Marshall Global Ventures website!</h2><p>Dear ${quote.name},</p><p>We have received your request for <strong>${quote.service}</strong> and we are currently reviewing the details of your request to ensure we provide the most accurate and tailored response.</p><p>One of our IT experts will contact you shortly to discuss your requirements and the best solutions available. We appreciate your interest and trust in Marshall Global Ventures.</p><p>If you have any additional information you'd like to share in the meantime, please feel free to reply to this email.</p><p><strong>Your message:</strong> ${quote.message}</p><p>Kind regards,<br/><strong>Marshall Global Ventures Team</strong></p,<br/><br/><p><em>If you did not request a quote, please ignore this email.</em></p>`
    });

    res.status(200).json({ message: 'Quote request sent and saved successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process request.', details: err.message });
  }
};

// Get all quote requests
exports.getAllQuoteRequests = async (req, res) => {
  console.log('getAllQuoteRequests called');
  try {
    const quotes = await QuoteRequest.find()
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });
    console.log('Quotes found:', quotes.length);
    res.status(200).json(quotes);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: 'Failed to fetch quote requests.' });
  }
};

exports.getSingleQuoteRequest = async (req, res) => {
  try {
    const quote = await QuoteRequest.findById(req.params.id)
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .exec();

    if (!quote) {
      return res.status(404).json({ error: 'Quote request not found.' });
    }

    if (req.user && req.user.role === 'customer' && req.user.email !== quote.email) {
      return res.status(403).json({ error: 'Unauthorized access to this quote.' });
    }
    res.status(200).json(quote);
  } catch (err) {
    console.error('Error fetching single quote:', err);
    res.status(500).json({ error: 'Failed to fetch quote request.' });
  }
};

exports.assignQuoteToAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedToUserId } = req.body;

    if (!assignedToUserId) {
      return res.status(400).json({ error: 'Assigned user ID is required.' });
    }

    const quote = await QuoteRequest.findById(id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote request not found.' });
    }

    const assignee = await User.findById(assignedToUserId);
    if (!assignee || (assignee.role !== 'admin' && assignee.role !== 'super admin')) {
      return res.status(400).json({ error: 'Invalid user for assignment. Must be an admin or super admin.' });
    }

    if (quote.assignedTo && quote.assignedTo.toString() === assignedToUserId) {
      const populatedQuote = await QuoteRequest.findById(quote._id)
        .populate('replies.senderId', 'name')
        .populate('assignedTo', 'name email')
        .exec();
      return res.status(200).json({ message: 'Quote already assigned to this admin.', updatedQuote: populatedQuote });
    }

    quote.assignedTo = assignedToUserId;
    quote.assignedAt = new Date();

    const updatedQuote = await quote.save();

    const populatedQuote = await QuoteRequest.findById(updatedQuote._id)
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .exec();

    const emailSubject = `New Quote Request Assigned to You: ${populatedQuote.service}`;
    const emailHtml = `
      <p>Dear ${populatedQuote.assignedTo.name || populatedQuote.assignedTo.email},</p>
      <p>A new quote request has been assigned to you for review and action.</p>
      <p><strong>Quote Details:</strong></p>
      <ul>
        <li><strong>Service:</strong> ${populatedQuote.service}</li>
        <li><strong>Customer Name:</strong> ${populatedQuote.name}</li>
        <li><strong>Customer Email:</strong> ${populatedQuote.email}</li>
        <li><strong>Message:</strong> ${populatedQuote.message}</li>
        <li><strong>Status:</strong> ${populatedQuote.status}</li>
      </ul>
      <p>Please log in to the admin panel to view the full details and respond to the customer.</p>
      <p><a href="https://mgv-tech.com/app/quote">Click here to view the quote in the admin panel</a></p>
      <p>Thank you,</p>
      <p>Your IT ServicePro Team</p>
    `;

    try {
      // CHANGED: Use transporter.sendMail directly
      await transporter.sendMail({
        to: populatedQuote.assignedTo.email,
        from: `"Marshall Global Ventures"`,
        subject: emailSubject,
        html: emailHtml,
        from: process.env.EMAIL_USER // Ensure this is set in your .env
      });
      console.log(`Assignment notification email sent to ${populatedQuote.assignedTo.email}`);
    } catch (emailError) {
      console.error('Error sending assignment notification email:', emailError);
    }

    res.status(200).json({ message: 'Quote assigned successfully!', updatedQuote: populatedQuote });
  } catch (err) {
    console.error('Error assigning quote:', err);
    res.status(500).json({ error: 'Failed to assign quote.' });
  }
};

exports.getCustomerQuotes = async (req, res) => {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ error: 'Unauthorized: Customer email not available.' });
  }

  try {
    const customerEmail = req.user.email;
    const quotes = await QuoteRequest.find({ email: customerEmail })
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json(quotes);
  } catch (err) {
    console.error('Error fetching customer quotes:', err);
    res.status(500).json({ error: 'Failed to fetch customer quote requests.' });
  }
};

exports.deleteQuoteRequest = async (req, res) => {
  try {
    await QuoteRequest.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Quote request deleted.' });
  } catch (err) {
    console.error('Error deleting quotes:', err);
    res.status(500).json({ error: 'Failed to delete quote request.' });
  }
};

exports.updateQuoteRequest = async (req, res) => {
  try {
    const updated = await QuoteRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate('assignedTo', 'name email');

    if (updated && updated.email) {
      const statusText = req.body.status ? `<p><strong>Status:</strong> ${req.body.status}</p>` : '';
      const detailsText = Object.keys(req.body).filter(k => k !== 'status').map(k => `<p><strong>${k}:</strong> ${req.body[k]}</p>`).join('');
      // CHANGED: Use transporter.sendMail directly
      await transporter.sendMail({
        to: updated.email,
        from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
        // from: process.env.EMAIL_USER,
        subject: 'Your Quote Request Has Been Updated',
        html: `<h2>Your Quote Request Update</h2>${statusText}${detailsText}<p>If you have questions, reply to this email.</p>`
      });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error('Error updating quotes:', err);
    res.status(500).json({ error: 'Failed to update quote request.' });
  }
};

exports.adminReplyToQuoteRequest = async (req, res) => {
  const { id } = req.params;
  const { replyMessage } = req.body;

  if (!replyMessage) {
    return res.status(400).json({ error: 'Reply message is required.' });
  }

  try {
    const quote = await QuoteRequest.findById(id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote request not found.' });
    }

    const adminEmail = req.user.email;
    const adminId = req.user.id;

    const newReply = {
      senderId: adminId,
      senderEmail: adminEmail,
      senderType: 'admin',
      message: replyMessage,
      repliedAt: new Date()
    };
    quote.replies.push(newReply);
    await quote.save();

    const updatedAndPopulatedQuote = await QuoteRequest.findById(id)
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .exec();

    // CHANGED: Use transporter.sendMail directly
    await transporter.sendMail({
      to: quote.email,
      from: `"Marshall Global Ventures"`,
      from: process.env.EMAIL_USER, // Using GMAIL_USER as the sender
      subject: `Reply to your Quote Request for ${quote.service} from Marshall Global Ventures`,
      html: `<h2>Regarding your Quote Request for ${quote.service}</h2>
             <p>Dear ${quote.name},</p>
             <p>Thank you for your interest in Marshall Global Ventures. We are replying to your quote request with the following message:</p>
             <div style="background-color: #f0f4f8; padding: 15px; border-radius: 8px; margin-top: 20px; margin-bottom: 20px;">
               <p style="white-space: pre-line; margin: 0;">${replyMessage}</p>
             </div>
             <p>If you have any further questions or require additional information, please do not hesitate to respond to this email.</p>
             <p>Kind regards,<br/><strong>Marshall Global Ventures Team</strong></p>`
    });

    res.status(200).json({
      message: 'Reply sent and saved successfully!',
      updatedQuote: updatedAndPopulatedQuote
    });
  } catch (err) {
    console.error('Error replying to quote (admin):', err);
    res.status(500).json({ error: 'Failed to send reply.', details: err.message });
  }
};

exports.customerReplyToQuote = async (req, res) => {
  const { id } = req.params;
  const { replyMessage } = req.body;

  if (!replyMessage) {
    return res.status(400).json({ error: 'Reply message is required.' });
  }

  try {
    const quote = await QuoteRequest.findById(id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote request not found.' });
    }

    if (!req.user || req.user.email !== quote.email) {
      return res.status(403).json({ error: 'Unauthorized: You can only reply to your own quotes.' });
    }

    const customerEmail = req.user.email;
    const customerId = req.user.id;

    const newReply = {
      senderId: customerId,
      senderEmail: customerEmail,
      senderType: 'customer',
      message: replyMessage,
      repliedAt: new Date()
    };
    quote.replies.push(newReply);
    await quote.save();

    const updatedAndPopulatedQuote = await QuoteRequest.findById(id)
      .populate('replies.senderId', 'name')
      .populate('assignedTo', 'name email')
      .exec();

    // Send email notification to admins about the customer's reply
    const adminEmails = getAdminEmails();
    // CHANGED: Use transporter.sendMail directly
    await transporter.sendMail({
      to: adminEmails[0] || process.env.RECEIVER_EMAIL,
      cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
      from: `"${quote.name}" <${quote.email}>`,
      subject: `Customer Reply to Quote Request #${id} from ${quote.name}`,
      html: `<p><strong>Hello Admin,</strong></p>
             <p>A customer has replied to their quote request:</p>
             <p><strong>Quote ID:</strong> ${id}</p>
             <p><strong>Customer:</strong> ${quote.name} (${quote.email})</p>
             <p><strong>Service:</strong> ${quote.service}</p>
             <p><strong>Reply Message:</strong></p>
             <div style="background-color: #f0f4f8; padding: 15px; border-radius: 8px; margin-top: 10px; margin-bottom: 20px;">
               <p style="white-space: pre-line; margin: 0;">${replyMessage}</p>
             </div>
             <p>Please <a href="https://mgv-tech.com/login">log in</a> to your admin dashboard to view the full conversation.</p>`
    });

    // Optionally send a confirmation to the customer that their reply was received
    // CHANGED: Use transporter.sendMail directly
    await transporter.sendMail({
      to: customerEmail,
      from: `"Marshall Global Ventures" <${process.env.EMAIL_USER}>`,
      from: process.env.EMAIL_USER, // Using GMAIL_USER as the sender
      subject: `Your Reply to Quote Request for ${quote.service} Has Been Sent`,
      html: `<h2>Your Reply Has Been Sent!</h2>
             <p>Dear ${quote.name},</p>
             <p>We have received your reply to your quote request for <strong>${quote.service}</strong>:</p>
             <div style="background-color: #f0f4f8; padding: 15px; border-radius: 8px; margin-top: 10px; margin-bottom: 20px;">
               <p style="white-space: pre-line; margin: 0;">${replyMessage}</p>
             </div>
             <p>Our team will review your message and get back to you shortly.</p>
             <p>Kind regards,<br/><strong>Marshall Global Ventures Team</strong></p>`
    });

    res.status(200).json({
      message: 'Reply sent and saved successfully!',
      updatedQuote: updatedAndPopulatedQuote
    });
  } catch (err) {
    console.error('Error replying to quote (customer):', err);
    res.status(500).json({ error: 'Failed to send reply.', details: err.message });
  }
};
