const config = require('../config');
const { LiveTmsClient } = require('./client');
const { MockTmsClient } = require('./mock');

function createTmsClient() {
  if (config.mode === 'live') {
    if (!config.tms.token) {
      throw new Error('TRANSLATION_MODE=live but PHRASE_API_TOKEN is empty');
    }
    return new LiveTmsClient(config.tms);
  }
  return new MockTmsClient();
}

module.exports = { createTmsClient };
