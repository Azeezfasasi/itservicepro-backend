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

exports.sendQuoteRequest = async (req, res) => {
  const { name, email, service, message } = req.body;
  if (!name || !email || !service || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Save to MongoDB
    const quote = new QuoteRequest({ name, email, service, message });
    await quote.save();

    // Send email
    const mailOptions = {
      from: `"${quote.name}" <${quote.email}>`,
      to: process.env.RECEIVER_EMAIL,
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
    res.status(200).json(updated);
  } catch (err) {
    console.error('Error updating quotes:', err);
    res.status(500).json({ error: 'Failed to update quote request.' });
  }
};