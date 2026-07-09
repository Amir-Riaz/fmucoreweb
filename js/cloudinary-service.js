// js/cloudinary-service.js
const CLOUD_NAME = "dhv3jyfkt";
const UPLOAD_PRESET = "w87awyq9";

/**
 * @param {File} file
 * @param {{folder?:string, publicId?:string, onProgress?:(pct:number)=>void}} opts
 * @returns {Promise<{secureUrl:string, publicId:string}>}
 */
export function uploadToCloudinary(file, { folder, publicId, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", UPLOAD_PRESET);
    if (folder) form.append("folder", folder);
    if (publicId) form.append("public_id", publicId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ secureUrl: data.secure_url, publicId: data.public_id });
        } else {
          reject(new Error(data.error?.message || `Upload failed (${xhr.status})`));
        }
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(form);
  });
}