let selectedLat = null;
let selectedLng = null;
let map = null;
let marker = null;
let routeControl = null;
let currentPosition = null;
let watchId = null;
let alertedTaskIds = new Set();
let arrivalInProgress = false;

const $ = (id) => document.getElementById(id);

function setStatus(message, isError = false) {
    const node = $("statusMessage");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error", isError);
}

function speak(text) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith("en-in")) || null;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}

function setSelectedLocation(lat, lng) {
    selectedLat = Number(lat);
    selectedLng = Number(lng);
    if (marker) marker.setLatLng([selectedLat, selectedLng]);
}

function initMap() {
    if (!window.L) {
        setStatus("The map library did not load. Check your internet connection and refresh.", true);
        return;
    }
    const fallback = [20.5937, 78.9629];
    map = L.map("map").setView(fallback, 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker(fallback, { draggable: true }).addTo(map);
    marker.bindPopup("Selected task location");
    marker.on("dragend", event => {
        const pos = event.target.getLatLng();
        setSelectedLocation(pos.lat, pos.lng);
    });
    map.on("click", event => setSelectedLocation(event.latlng.lat, event.latlng.lng));

    if (!navigator.geolocation) {
        setStatus("Geolocation is not supported in this browser. Click the map to select a task location.");
        return;
    }
    navigator.geolocation.getCurrentPosition(position => {
        currentPosition = [position.coords.latitude, position.coords.longitude];
        map.setView(currentPosition, 15);
        setSelectedLocation(...currentPosition);
        setStatus("Your location is ready. Click or drag the marker to choose a task location.");
        loadTasks();
        startLocationWatch();
    }, error => {
        const messages = {
            1: "Location permission was denied. You can still select a location by clicking the map.",
            2: "Your location is unavailable. Click the map to choose a task location.",
            3: "Location lookup timed out. Click the map to choose a task location."
        };
        setStatus(messages[error.code] || "Could not access your location. Select a location on the map.");
        loadTasks();
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

async function saveTask() {
    const title = $("taskName").value.trim();
    if (!title) {
        setStatus("Enter a task name first.", true);
        $("taskName").focus();
        return;
    }
    if (title.length > 200) {
        setStatus("Task names must be 200 characters or fewer.", true);
        return;
    }
    if (selectedLat === null || selectedLng === null) {
        setStatus("Select a location by clicking or dragging the marker on the map.", true);
        return;
    }

    const button = $("addTaskButton");
    button.disabled = true;
    try {
        const response = await fetch("/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, lat: selectedLat, lng: selectedLng })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not save the task.");
        $("taskName").value = "";
        setStatus("Task saved.");
        await loadTasks();
    } catch (error) {
        setStatus(error.message || "Could not save the task. Please try again.", true);
    } finally {
        button.disabled = false;
    }
}

async function fetchTasks() {
    const response = await fetch("/tasks");
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error(data.error || "Could not load tasks.");
    return data;
}

function renderTasks(tasks) {
    const list = $("taskList");
    list.replaceChildren();
    if (!tasks.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No saved tasks yet. Add a task and choose its location on the map.";
        list.appendChild(empty);
        return;
    }

    tasks.forEach(task => {
        const row = document.createElement("article");
        row.className = "task";

        const info = document.createElement("div");
        info.className = "task-info";
        const title = document.createElement("div");
        title.className = "task-title";
        title.textContent = `📍 ${task[1]}`;
        const meta = document.createElement("div");
        meta.className = "task-meta";
        const hasCoords = Number.isFinite(Number(task[2])) && Number.isFinite(Number(task[3]));
        meta.textContent = hasCoords ? "Location saved" : "No location saved";
        info.append(title, meta);

        const actions = document.createElement("div");
        actions.className = "task-actions";
        if (hasCoords) {
            const route = document.createElement("button");
            route.className = "route-button";
            route.type = "button";
            route.textContent = "Show route";
            route.addEventListener("click", () => showRoute(Number(task[2]), Number(task[3])));
            actions.appendChild(route);
        }
        const remove = document.createElement("button");
        remove.className = "delete-button";
        remove.type = "button";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => deleteTask(task[0]));
        actions.appendChild(remove);

        row.append(info, actions);
        list.appendChild(row);
    });
}

async function loadTasks() {
    try {
        let tasks = await fetchTasks();
        if (currentPosition) {
            tasks.sort((a, b) => distanceKm(currentPosition[0], currentPosition[1], a[2], a[3]) -
                distanceKm(currentPosition[0], currentPosition[1], b[2], b[3]));
        }
        renderTasks(tasks);
    } catch (error) {
        $("taskList").replaceChildren();
        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = error.message || "Could not load tasks.";
        $("taskList").appendChild(message);
    }
}

async function deleteTask(id) {
    try {
        const response = await fetch(`/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not delete task.");
        alertedTaskIds.delete(Number(id));
        setStatus("Task deleted.");
        await loadTasks();
    } catch (error) {
        setStatus(error.message || "Could not delete task.", true);
    }
}

async function searchLocation() {
    const query = $("searchBox").value.trim();
    if (!query) {
        setStatus("Enter a place or address to search.", true);
        return;
    }
    try {
        setStatus("Searching for location…");
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, { headers: { "Accept-Language": "en" } });
        if (!response.ok) throw new Error("Location search service is unavailable.");
        const data = await response.json();
        if (!data.length) throw new Error("Location not found. Try a more specific search.");
        const lat = Number(data[0].lat);
        const lng = Number(data[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("The returned location was invalid.");
        setSelectedLocation(lat, lng);
        map.setView([lat, lng], 16);
        marker.openPopup();
        setStatus(`Found: ${data[0].display_name}`);
    } catch (error) {
        setStatus(error.message || "Location search failed.", true);
    }
}

function showRoute(lat, lng) {
    if (!map || !window.L) return;
    if (!currentPosition) {
        setSelectedLocation(lat, lng);
        map.setView([lat, lng], 15);
        setStatus("Your current location is unavailable. The task location is shown on the map.");
        return;
    }
    if (!window.L.Routing) {
        setStatus("Route service did not load. You can still view the selected task location.", true);
        setSelectedLocation(lat, lng);
        map.setView([lat, lng], 15);
        return;
    }
    if (routeControl) map.removeControl(routeControl);
    routeControl = L.Routing.control({
        waypoints: [L.latLng(currentPosition[0], currentPosition[1]), L.latLng(lat, lng)],
        routeWhileDragging: false,
        show: false,
        addWaypoints: false,
        createMarker: () => null
    }).addTo(map);
    setSelectedLocation(lat, lng);
    map.setView([lat, lng], 14);
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(Number);
    if (values.some(v => !Number.isFinite(v))) return Number.POSITIVE_INFINITY;
    const [aLat, aLng, bLat, bLng] = values;
    const rad = d => d * Math.PI / 180;
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function startLocationWatch() {
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(async position => {
        currentPosition = [position.coords.latitude, position.coords.longitude];
        try {
            const tasks = await fetchTasks();
            if (!tasks.length || arrivalInProgress) return;
            const sorted = tasks.filter(t => Number.isFinite(Number(t[2])) && Number.isFinite(Number(t[3])))
                .sort((a, b) => distanceKm(...currentPosition, a[2], a[3]) -
                    distanceKm(...currentPosition, b[2], b[3]));
            const nearest = sorted[0];
            if (!nearest) return;
            const distance = distanceKm(...currentPosition, nearest[2], nearest[3]);
            if (distance <= 0.1 && !alertedTaskIds.has(Number(nearest[0]))) {
                alertedTaskIds.add(Number(nearest[0]));
                arrivalInProgress = true;
                speak(`You have reached ${nearest[1]}`);
                setStatus(`You are within 100 metres of "${nearest[1]}".`);
                const shouldDelete = window.confirm(`You are within 100 metres of "${nearest[1]}". Mark this task complete and delete it?`);
                if (shouldDelete) await deleteTask(nearest[0]);
                arrivalInProgress = false;
            }
        } catch (_) {
            // A temporary network failure should not stop GPS tracking.
        }
    }, error => {
        if (error.code === 1) setStatus("Location access was denied. Map selection and saved tasks still work.");
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}

window.addEventListener("load", initMap);
window.addEventListener("beforeunload", () => {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
});
