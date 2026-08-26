const { resolveSetup, publicForUser, DIAAB_TEMPLATE_UID, LOC_TEMPLATE_UID } = require('./customers');

function publicSetups(config, opts = {}) {
  return publicForUser(opts);
}

module.exports = {
  publicSetups,
  resolveSetup,
  DIAAB_TEMPLATE_UID,
  LOC_TEMPLATE_UID,
};
