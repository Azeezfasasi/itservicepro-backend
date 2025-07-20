const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Project title is required'],
    trim: true,
  },
  category: {
    type: String,
    required: [true, 'Project category is required'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Project description is required'],
  },
  technologyUsed: {
    type: String,
    required: [true, 'Technologies used are required'],
    trim: true,
  },
  clientIndustry: {
    type: String,
    required: [true, 'Client industry is required'],
    trim: true,
  },
  // Array of image URLs from Cloudinary
  images: [
    {
      url: {
        type: String,
        required: true,
      },
      public_id: { // Store public_id to easily delete from Cloudinary later
        type: String,
        required: true,
      },
    },
  ],
  // This will store the string name of the Lucide icon (e.g., 'Monitor', 'Smartphone')
  icon: {
    type: String,
    required: [true, 'Icon name is required'],
    trim: true,
  },
  link: { // Optional external link for the project
    type: String,
    trim: true,
    default: '#', // Default to '#' if no specific link
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Project', ProjectSchema);
