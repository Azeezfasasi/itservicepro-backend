const mongoose = require('mongoose');

const quoteRequestSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: false },
  service: { type: String, required: true },
  message: { type: String, required: true },
  status: {
  type: String,
  enum: ['Pending', 'In Review', 'Done', 'Completed', 'Rejected'],
  default: 'Pending'
  },
   // You could add a field to store replies, e.g.:
  replies: [{
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
    repliedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('QuoteRequest', quoteRequestSchema);