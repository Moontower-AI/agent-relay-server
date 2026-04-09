'use strict';

const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

mongoose.set('strictQuery', true);

async function connect() {
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongoose connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongoose disconnected');
  });

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });
  logger.info('mongoose connected');
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect, mongoose };
