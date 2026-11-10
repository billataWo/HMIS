/**
 * HMIS's licence-signing public key (Ed25519, PEM). Every clinic server and own-server install
 * checks licences against it. HMIS created the key pair once, offline
 * (`node dist/licence/cli.js keygen`). The public key is here (committed); the private key is only
 * in the HMIS cloud's environment, as HMIS_LICENCE_PRIVATE_KEY.
 *
 * HMIS_LICENCE_PUBLIC_KEY in the environment overrides it (tests).
 */
export const BUILT_IN_LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAALB7G1gzLoyODbq+H4KMyN8GItkpe2x7PIrUqCNhoOk=
-----END PUBLIC KEY-----
`;
