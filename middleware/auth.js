const jwt = require('jsonwebtoken');
require('dotenv').config();

const auth = (req, res, next) => {
  console.log('Auth called');
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

function authorizeRoles(req, res, next) {
  console.log('authorizeRoles called');
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super admin')) {
    next();
  } else {
    return res.status(403).json({ error: 'Admin access required' });
  }
}

module.exports = { auth, authorizeRoles };