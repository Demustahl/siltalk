import { encryptAttachmentFile } from "./e2ee.js";

export const MAX_ATTACHMENT_FILES = 5;
export const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;

export function formatFileSize(size) {
  if (!Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} Б`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} КБ`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export function filterAttachmentFiles(existingFiles, addedFiles) {
  const nextFiles = [...existingFiles];

  for (const file of addedFiles) {
    if (nextFiles.length >= MAX_ATTACHMENT_FILES) {
      break;
    }
    if (file.size <= MAX_ATTACHMENT_FILE_BYTES) {
      nextFiles.push(file);
    }
  }

  return nextFiles;
}

export async function prepareEncryptedAttachments(api, files) {
  const attachments = [];

  for (const file of files) {
    const encryptedAttachment = await encryptAttachmentFile(file);
    const uploadedAttachment = await api.uploadAttachment(
      encryptedAttachment.encryptedBytes,
    );

    attachments.push({
      ...encryptedAttachment.metadata,
      id: uploadedAttachment.id,
    });
  }

  return attachments;
}
