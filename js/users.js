import {
  db,
  USERS_COLLECTION,
  collection,
  getDocs,
} from "./firebase-config.js";

const tbody = document.getElementById("usersTable");

function safe(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false
  ) {
    return "N/A";
  }

  return value;
}

function formatDate(timestamp) {
  try {
    if (!timestamp) return "N/A";

    if (typeof timestamp.toDate === "function") {
      return timestamp.toDate().toLocaleString();
    }

    return "N/A";
  } catch (err) {
    return "N/A";
  }
}

async function loadUsers() {
  tbody.innerHTML = `
    <tr>
      <td colspan="11" class="text-center py-8 text-slate-500">
        Loading users...
      </td>
    </tr>
  `;

  try {
    const usersRef = collection(db, USERS_COLLECTION);
    const snapshot = await getDocs(usersRef);

    if (snapshot.empty) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="text-center py-8 text-slate-500">
            No users found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = "";

    let index = 1;

    snapshot.forEach((docSnap) => {
      const user = docSnap.data() || {};

      const row = document.createElement("tr");
      row.className = "border-b hover:bg-slate-50";

      row.innerHTML = `
        <td class="px-4 py-3">${index++}</td>
        <td class="px-4 py-3">${safe(user.fullName)}</td>
        <td class="px-4 py-3">${safe(user.email)}</td>
        <td class="px-4 py-3">${safe(user.phone)}</td>
        <td class="px-4 py-3">${safe(user.cnic)}</td>
        <td class="px-4 py-3">${safe(user.organization)}</td>
        <td class="px-4 py-3">${safe(user.role)}</td>
        <td class="px-4 py-3">${safe(user.status)}</td>
        <td class="px-4 py-3">${safe(user.serial)}</td>
        <td class="px-4 py-3">${formatDate(user.createdAt)}</td>
        <td class="px-4 py-3 text-xs break-all">${safe(
          user.uid || docSnap.id
        )}</td>
      `;

      tbody.appendChild(row);
    });

    console.log(`Loaded ${snapshot.size} users.`);
  } catch (error) {
    console.error("Error loading users:", error);

    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-8 text-red-600">
          Failed to load users.
        </td>
      </tr>
    `;
  }
}

loadUsers();