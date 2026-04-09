'use strict';

const express = require('express');
const { mongoose } = require('../db');

const router = express.Router();

router.get('/', async (_req, res) => {
  const mongoState = mongoose.connection.readyState; // 1 = connected
  const ok = mongoState === 1;
  res.status(ok ? 200 : 503).json({
    ok,
    mongo: mongoState,
    uptime: process.uptime(),
  });
});

module.exports = router;
