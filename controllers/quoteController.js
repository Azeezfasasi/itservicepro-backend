const nodemailer = require('nodemailer');
const QuoteRequest = require('../models/QuoteRequest');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
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
    const mailOptions = {
      from: `"${quote.name}" <${quote.email}>`,
      to: adminEmails[0] || process.env.RECEIVER_EMAIL, // fallback to RECEIVER_EMAIL if no admins
      cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
      subject: `Quote Request from ${quote.name} on IT Service Pro`,
      text: `Service: ${quote.service}\nMessage: ${quote.message}\nFrom: ${quote.name} <${quote.email}>`,
      html: `<p><strong>Hello Admin,</strong></p><p>A new quote request has just been submitted through the IT Service Pro website. Please review the details below:</p><p><strong>Service Requested:</strong> ${quote.service}</p><p><strong>Message:</strong> ${quote.message}</p><p><strong>From:</strong> ${quote.name} (${quote.email}) (${quote.phone})</p><br /><p>Please <a href="https://itservicepro.netlify.app/login">log in</a> to your admin dashboard to follow up or assign this request to a team member.</p>`
    };
    await transporter.sendMail(mailOptions);

    // Send confirmation email to customer
    await transporter.sendMail({
      to: quote.email,
      from: process.env.GMAIL_USER,
      subject: 'We Received Your Quote Request on IT Service Pro',
      html: `<h2>Thank you for submitting a quote request through the IT Service Pro website!</h2><p>Dear ${quote.name},</p><p>We have received your request for <strong>${quote.service}</strong> and we are currently reviewing the details of your request to ensure we provide the most accurate and tailored response.</p><p>One of our IT experts will contact you shortly to discuss your requirements and the best solutions available. We appreciate your interest and trust in IT Service Pro.</p><p>If you have any additional information you'd like to share in the meantime, please feel free to reply to this email.</p><p><strong>Your message:</strong> ${quote.message}</p><p>Kind regards,<br/><strong>IT Service Pro Team</strong></p,<br/><br/><p><em>If you did not request a quote, please ignore this email.</em></p>`
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
    const quotes = await QuoteRequest.find().sort({ createdAt: -1 });
    console.log('Quotes found:', quotes.length);
    res.status(200).json(quotes);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: 'Failed to fetch quote requests.' });
  }
};

// Delete a quote request
exports.deleteQuoteRequest = async (req, res) => {
  try {
    await QuoteRequest.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Quote request deleted.' });
  } catch (err) {
    console.error('Error deleting quotes:', err);
    res.status(500).json({ error: 'Failed to delete quote request.' });
  }
};

// Update a quote request (edit details or status)
exports.updateQuoteRequest = async (req, res) => {
  try {
    const updated = await QuoteRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    // Send email to customer if status or details updated
    if (updated && updated.email) {
      const statusText = req.body.status ? `<p><strong>Status:</strong> ${req.body.status}</p>` : '';
      const detailsText = Object.keys(req.body).filter(k => k !== 'status').map(k => `<p><strong>${k}:</strong> ${req.body[k]}</p>`).join('');
      await transporter.sendMail({
        to: updated.email,
        from: process.env.GMAIL_USER,
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

// function to reply to a quote request
exports.replyToQuoteRequest = async (req, res) => {
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

    // Send email to the quote requestor
    await transporter.sendMail({
      to: quote.email,
      from: process.env.GMAIL_USER,
      subject: `Reply to your Quote Request for ${quote.service} from IT Service Pro`,
      html: `<h2>Regarding your Quote Request for ${quote.service}</h2>
             <p>Dear ${quote.name},</p>
             <p>Thank you for your interest in IT Service Pro. We are replying to your quote request with the following message:</p>
             <div style="background-color: #f0f4f8; padding: 15px; border-radius: 8px; margin-top: 20px; margin-bottom: 20px;">
               <p style="white-space: pre-line; margin: 0;">${replyMessage}</p>
             </div>
             <p>If you have any further questions or require additional information, please do not hesitate to respond to this email.</p>
             <p>Kind regards,<br/><strong>IT Service Pro Team</strong></p>`
    });

    // Optionally, you might want to save the reply in the quote request document
    // For example, by adding a 'replies' array to your QuoteRequest model.
    // For now, we'll just send the email and indicate success.
    res.status(200).json({ message: 'Reply sent successfully to the customer!' });
  } catch (err) {
    console.error('Error replying to quote:', err);
    res.status(500).json({ error: 'Failed to send reply.', details: err.message });
  }
};