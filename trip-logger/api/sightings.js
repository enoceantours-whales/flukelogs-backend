const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  try {
    const root = fs.readdirSync('/var/task');
    const tripLogger = fs.readdirSync('/var/task/trip-logger');
    const pub = fs.readdirSync('/var/task/trip-logger/Public');
    res.status(200).send(`root: ${root.join(', ')}\n\ntrip-logger: ${tripLogger.join(', ')}\n\nPublic: ${pub.join(', ')}`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
};
