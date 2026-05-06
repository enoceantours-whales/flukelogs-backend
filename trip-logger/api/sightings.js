const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html');
  try {
    const filePath = path.join(process.cwd(), 'trip-logger', 'Public', 'sightings-widget.html');
    const html = fs.readFileSync(filePath, 'utf8');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).send(`Path error: ${err.message} | cwd: ${process.cwd()}`);
  }
};
