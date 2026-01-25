/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const path = require('path');

function loadNative() {
  const candidates = ['index.node', 'core_rs.node'];
  let lastError;
  for (const candidate of candidates) {
    const localPath = path.join(__dirname, candidate);
    try {
      return require(localPath);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError && lastError.message ? lastError.message : String(lastError);
  throw new Error(`Failed to load core_rs native module: ${message}`);
}

module.exports = loadNative();
