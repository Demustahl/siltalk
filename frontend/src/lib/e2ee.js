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
  text = "",
  attachments = [],
  recipients = [],
  senderUsername,
  senderPublicKey,
  receiverUsername,
  receiverPublicKey,
}) {
  await ensureSodium();
  const payload = JSON.stringify({
    version: 2,
    type: "siltalk.message",
    text,
    attachments,
  });
  const recipientKeys =
    recipients.length > 0
      ? recipients
      : [
          { username: receiverUsername, publicKey: receiverPublicKey },
          { username: senderUsername, publicKey: senderPublicKey },
        ];
  const encryptedRecipients = {};

  for (const recipient of recipientKeys) {
    if (!recipient?.username || !recipient?.publicKey) {
      continue;
    }

    encryptedRecipients[recipient.username] = encryptForPublicKey(
      payload,
      recipient.publicKey,
    );
  }

  return JSON.stringify({
    version: 1,
    algorithm: "libsodium.crypto_box_seal",
    recipients: encryptedRecipients,
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

export async function decryptMessageEnvelope(ciphertext, username, keyPair) {
  const plaintext = await decryptEnvelope(ciphertext, username, keyPair);

  try {
    const payload = JSON.parse(plaintext);
    if (payload?.type !== "siltalk.message") {
      return { text: plaintext, attachments: [] };
    }

    return {
      text: typeof payload.text === "string" ? payload.text : "",
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    };
  } catch {
    return { text: plaintext, attachments: [] };
  }
}

export async function encryptAttachmentFile(file) {
  await ensureSodium();

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const encryptedBytes = sodium.crypto_secretbox_easy(fileBytes, nonce, key);

  return {
    encryptedBytes,
    metadata: {
      version: 1,
      algorithm: "libsodium.crypto_secretbox_easy",
      name: file.name || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      key: encodeBytes(key),
      nonce: encodeBytes(nonce),
    },
  };
}

export async function decryptAttachmentBlob(encryptedBuffer, attachment) {
  await ensureSodium();

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const decryptedBytes = sodium.crypto_secretbox_open_easy(
    encryptedBytes,
    decodeBytes(attachment.nonce),
    decodeBytes(attachment.key),
  );

  return new Blob([decryptedBytes], {
    type: attachment.mime || "application/octet-stream",
  });
}
