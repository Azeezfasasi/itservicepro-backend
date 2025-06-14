const mongoose = require('mongoose');

const quoteRequestSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  service: { type: String, required: true },
  message: { type: String, required: true },
  status: {
  type: String,
  enum: ['Pending', 'In Review', 'Done', 'Completed', 'Rejected'],
  default: 'Pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('QuoteRequest', quoteRequestSchema);