import sodium from "libsodium-wrappers-sumo";

let sodiumReady = null;

async function ensureSodium() {
  if (!sodiumReady) {
    sodiumReady = sodium.ready;
  }

  await sodiumReady;
  return sodium;
}

function keyStorageName(username) {
  return `e2ee-keypair:${username}`;
}

function encodeBytes(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function decodeBytes(base64Text) {
  return sodium.from_base64(base64Text, sodium.base64_variants.ORIGINAL);
}

function readSavedKeyPair(username) {
  const saved = localStorage.getItem(keyStorageName(username));
  if (!saved) {
    return null;
  }

  try {
    const data = JSON.parse(saved);
    if (!data.publicKey || !data.privateKey) {
      return null;
    }

    return {
      publicKey: decodeBytes(data.publicKey),
      privateKey: decodeBytes(data.privateKey),
    };
  } catch {
    return null;
  }
}

function saveKeyPair(username, keyPair) {
  localStorage.setItem(
    keyStorageName(username),
    JSON.stringify({
      publicKey: encodeBytes(keyPair.publicKey),
      privateKey: encodeBytes(keyPair.privateKey),
    }),
  );
}

export async function ensureLocalKeyPair(username) {
  await ensureSodium();

  let keyPair = readSavedKeyPair(username);
  if (!keyPair) {
    keyPair = sodium.crypto_box_keypair();
    saveKeyPair(username, keyPair);
  }

  return {
    keyPair,
    publicKey: encodeBytes(keyPair.publicKey),
  };
}

function encryptForPublicKey(text, publicKey) {
  const plaintext = sodium.from_string(text);
  const publicKeyBytes = decodeBytes(publicKey);
  const ciphertextBytes = sodium.crypto_box_seal(plaintext, publicKeyBytes);

  return encodeBytes(ciphertextBytes);
}

export async function createEncryptedEnvelope({
  text,
  senderUsername,
  senderPublicKey,
  receiverUsername,
  receiverPublicKey,
}) {
  await ensureSodium();

  return JSON.stringify({
    version: 1,
    algorithm: "libsodium.crypto_box_seal",
    recipients: {
      [receiverUsername]: encryptForPublicKey(text, receiverPublicKey),
      [senderUsername]: encryptForPublicKey(text, senderPublicKey),
    },
  });
}

export async function decryptEnvelope(ciphertext, username, keyPair) {
  await ensureSodium();

  if (!keyPair) {
    return "Ключ для расшифровки не загружен";
  }

  try {
    const envelope = JSON.parse(ciphertext);
    const encryptedForMe = envelope.recipients?.[username];
    if (!encryptedForMe) {
      return "Сообщение зашифровано не для этого ключа";
    }

    const decryptedBytes = sodium.crypto_box_seal_open(
      decodeBytes(encryptedForMe),
      keyPair.publicKey,
      keyPair.privateKey,
    );

    return sodium.to_string(decryptedBytes);
  } catch {
    return "Не удалось расшифровать сообщение";
  }
}
