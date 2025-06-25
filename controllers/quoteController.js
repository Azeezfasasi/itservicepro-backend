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
  const { name, email, service, message } = req.body;
  if (!name || !email || !service || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Save to MongoDB
    const quote = new QuoteRequest({ name, email, service, message });
    await quote.save();

    // Send email to admins
    const adminEmails = getAdminEmails();
    const mailOptions = {
      from: `"${quote.name}" <${quote.email}>`,
      to: adminEmails[0] || process.env.RECEIVER_EMAIL, // fallback to RECEIVER_EMAIL if no admins
      cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
      subject: `Quote Request from ${quote.name}`,
      text: `Service: ${quote.service}\nMessage: ${quote.message}\nFrom: ${quote.name} <${quote.email}>`,
      html: `<h2>New Quote Request</h2><p><strong>Service:</strong> ${quote.service}</p><p><strong>Message:</strong> ${quote.message}</p><p><strong>From:</strong> ${quote.name} (${quote.email})</p>`
    };
    await transporter.sendMail(mailOptions);

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