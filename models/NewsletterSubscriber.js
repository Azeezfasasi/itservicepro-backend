const mongoose = require('mongoose');

const newsletterSubscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String },
  isActive: { type: Boolean, default: true },
  subscribedAt: { type: Date, default: Date.now },
  unsubscribedAt: { type: Date },
  lastNewsletterSentAt: { type: Date },
  tags: [{ type: String }], // For segmentation
  notes: { type: String },
});

module.exports = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
