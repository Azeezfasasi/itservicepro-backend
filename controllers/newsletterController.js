const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const Newsletter = require('../models/Newsletter');
const User = require('../models/User');
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Subscribe to newsletter
exports.subscribe = async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    let subscriber = await NewsletterSubscriber.findOne({ email });
    if (subscriber && subscriber.isActive) {
      return res.status(200).json({ message: 'Already subscribed.' });
    }
    if (subscriber) {
      subscriber.isActive = true;
      subscriber.unsubscribedAt = undefined;
      subscriber.name = name || subscriber.name;
      await subscriber.save();
    } else {
      subscriber = await NewsletterSubscriber.create({ email, name });
    }
    res.status(201).json({ message: 'Subscribed successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to subscribe.', details: err.message });
  }
};

// Unsubscribe
exports.unsubscribe = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const subscriber = await NewsletterSubscriber.findOne({ email });
    if (!subscriber || !subscriber.isActive) {
      return res.status(404).json({ error: 'Subscriber not found or already unsubscribed.' });
    }
    subscriber.isActive = false;
    subscriber.unsubscribedAt = new Date();
    await subscriber.save();
    res.status(200).json({ message: 'Unsubscribed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe.', details: err.message });
  }
};

// Admin: View all subscribers
exports.getAllSubscribers = async (req, res) => {
  try {
    const subscribers = await NewsletterSubscriber.find();
    res.status(200).json(subscribers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscribers.' });
  }
};

// Admin: Edit subscriber
exports.editSubscriber = async (req, res) => {
  try {
    const updated = await NewsletterSubscriber.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subscriber.' });
  }
};

// Admin: Remove subscriber
exports.removeSubscriber = async (req, res) => {
  try {
    await NewsletterSubscriber.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Subscriber removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscriber.' });
  }
};

// Admin: Send newsletter
exports.sendNewsletter = async (req, res) => {
  const { subject, content, recipients } = req.body;
  if (!subject || !content) return res.status(400).json({ error: 'Subject and content are required.' });
  try {
    let emails = recipients;
    if (!emails || !emails.length) {
      emails = (await NewsletterSubscriber.find({ isActive: true })).map(s => s.email);
    }
    const newsletter = await Newsletter.create({ subject, content, recipients: emails, sentAt: new Date(), sentBy: req.user?._id, status: 'sent' });
    // Send email to all
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: emails[0],
      bcc: emails.length > 1 ? emails.slice(1) : undefined,
      subject,
      html: content
    });
    // Update lastNewsletterSentAt for subscribers
    await NewsletterSubscriber.updateMany({ email: { $in: emails } }, { lastNewsletterSentAt: new Date() });
    res.status(200).json({ message: 'Newsletter sent!', newsletter });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send newsletter.', details: err.message });
  }
};

// Admin: View all sent newsletters
exports.getAllNewsletters = async (req, res) => {
  try {
    const newsletters = await Newsletter.find().sort({ createdAt: -1 });
    res.status(200).json(newsletters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch newsletters.' });
  }
};

// Admin: Edit sent newsletter (only if draft)
exports.editNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) return res.status(404).json({ error: 'Newsletter not found.' });
    if (newsletter.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent newsletter.' });
    Object.assign(newsletter, req.body, { updatedAt: new Date() });
    await newsletter.save();
    res.status(200).json(newsletter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update newsletter.' });
  }
};

// Admin: Create draft newsletter
exports.createDraftNewsletter = async (req, res) => {
  const { subject, content, recipients } = req.body;
  if (!subject || !content) return res.status(400).json({ error: 'Subject and content are required.' });
  try {
    const newsletter = await Newsletter.create({ subject, content, recipients, status: 'draft' });
    res.status(201).json(newsletter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create draft newsletter.' });
  }
};

// Admin: Delete newsletter
exports.deleteNewsletter = async (req, res) => {
  try {
    await Newsletter.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Newsletter deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete newsletter.' });
  }
};
