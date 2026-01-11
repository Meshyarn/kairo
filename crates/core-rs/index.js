/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const path = require('path');

function loadNative() {
  const localPath = path.join(__dirname, 'core_rs.node');
  try {
    return require(localPath);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Failed to load core_rs native module: ${message}`);
  }
}

module.exports = loadNative();
