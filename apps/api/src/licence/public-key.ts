/**
 * HMIS's licence-signing public key (Ed25519, PEM). Every clinic server and own-server install
 * checks licences against it. HMIS creates the key pair once, offline
 * (`node dist/licence/cli.js keygen`). The public key goes here (committed); the private key goes
 * only into the HMIS cloud's deploy/.env as HMIS_LICENCE_PRIVATE_KEY.
 *
 * HMIS_LICENCE_PUBLIC_KEY in the environment overrides it (tests, or before it is filled in here).
 */
export const BUILT_IN_LICENCE_PUBLIC_KEY = '';
