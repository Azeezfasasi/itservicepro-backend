// const cloudinary = require('cloudinary').v2;

// cloudinary.config({
//   cloud_name: 'dtvyv2qvi',
//   api_key: '264143534149483',
//   api_secret: 'mNf0yXlcQryEY8yPgbe1GNMhOhc'
// });

const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});