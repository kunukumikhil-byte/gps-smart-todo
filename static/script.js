let selectedLat = null;
let selectedLng = null;
let map, marker, routeControl;

// ✅ Text To Speech
function speak(text) {
    if (!("speechSynthesis" in window)) {
        console.log("TTS not supported");
        return;
    }

    const utter = new SpeechSynthesisUtterance(text);

    // Optional: choose better voice
    const voices = speechSynthesis.getVoices();
    let preferred = voices.find(v => v.lang.includes("en-IN")) || voices[0];
    utter.voice = preferred;
    utter.pitch = 1;
    utter.rate = 1;
    utter.volume = 1;

    // Required: cancel ongoing speech (fixes no-voice bug)
    speechSynthesis.cancel();

    setTimeout(() => {
        speechSynthesis.speak(utter);
    }, 200);
}

// ✅ Initialize Map
function initMap() {
    navigator.geolocation.getCurrentPosition(position => {
        const userLocation = [position.coords.latitude, position.coords.longitude];

        map = L.map("map").setView(userLocation, 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
        }).addTo(map);

        marker = L.marker(userLocation, { draggable: true }).addTo(map);

        selectedLat = userLocation[0];
        selectedLng = userLocation[1];

        marker.on("dragend", function (event) {
            const pos = event.target.getLatLng();
            selectedLat = pos.lat;
            selectedLng = pos.lng;
        });

        map.on("click", function (event) {
            marker.setLatLng(event.latlng);
            selectedLat = event.latlng.lat;
            selectedLng = event.latlng.lng;
        });
    });
}

window.onload = initMap;

// ✅ Save Task
function saveTask() {
    let taskName = document.getElementById("taskName").value;
    if (!taskName) return alert("Enter task name!");

    fetch("/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title: taskName,
            lat: selectedLat,
            lng: selectedLng
        })
    }).then(() => {
        alert("✅ Task Saved");
        loadTasks();
    });
}

// ✅ Load tasks sorted by nearest
function loadTasks() {
    navigator.geolocation.getCurrentPosition(current => {
        fetch("/tasks")
            .then(res => res.json())
            .then(tasks => {

                tasks.sort((a, b) => {
                    return getDistance(
                        current.coords.latitude, current.coords.longitude, a[2], a[3]
                    ) - getDistance(
                        current.coords.latitude, current.coords.longitude, b[2], b[3]
                    );
                });

                document.getElementById("taskList").innerHTML = "";

                tasks.forEach(task => {
                    document.getElementById("taskList").innerHTML += `
                        <div class="task">
                            📍 ${task[1]}
                            <button onclick="deleteTask(${task[0]})">❌</button>
                        </div>
                    `;
                });
            });
    });
}
loadTasks();

// ✅ Delete task manually
function deleteTask(id) {
    fetch(`/delete/${id}`, { method: "DELETE" })
        .then(() => loadTasks());
}

// ✅ Search location using NOMINATIM API (OpenStreetMap)
function searchLocation() {
    let query = document.getElementById("searchBox").value;
    if (!query) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}`)
        .then(res => res.json())
        .then(data => {
            if (data.length === 0) return alert("Location not found!");

            let lat = data[0].lat;
            let lon = data[0].lon;

            map.setView([lat, lon], 17);
            marker.setLatLng([lat, lon]);

            selectedLat = lat;
            selectedLng = lon;
        });
}

// ✅ Draw Route between current location and target
function drawRoute(start, end) {
    if (routeControl) map.removeControl(routeControl);

    routeControl = L.Routing.control({
        waypoints: [
            L.latLng(start[0], start[1]),
            L.latLng(end[0], end[1])
        ],
        routeWhileDragging: false
    }).addTo(map);
}

// ✅ Auto Navigation Logic: nearest first, speak next target
navigator.geolocation.watchPosition(current => {
    fetch("/tasks")
        .then(res => res.json())
        .then(tasks => {

            if (tasks.length === 0) return;

            tasks.sort((a, b) => {
                return getDistance(
                    current.coords.latitude, current.coords.longitude, a[2], a[3]
                ) - getDistance(
                    current.coords.latitude, current.coords.longitude, b[2], b[3]
                );
            });

            let nearest = tasks[0];

            drawRoute(
                [current.coords.latitude, current.coords.longitude],
                [nearest[2], nearest[3]]
            );

            let distance = getDistance(
                current.coords.latitude,
                current.coords.longitude,
                nearest[2],
                nearest[3]
            );

            if (distance < 0.10) {
                alert(`✅ You reached: ${nearest[1]}`);
                speak(`You reached ${nearest[1]}`);

                fetch(`/delete/${nearest[0]}`, { method: "DELETE" })
                    .then(() => {
                        fetch("/tasks")
                            .then(res => res.json())
                            .then(updatedTasks => {

                                if (updatedTasks.length > 0) {
                                    let next = updatedTasks[0];
                                    alert(`➡ Next Target: ${next[1]}`);
                                    speak(`Next target is ${next[1]}`);
                                } else {
                                    alert("🎉 All tasks completed!");
                                    speak("All tasks completed");
                                }

                                loadTasks();
                            });
                    });
            }
        });
});

// ✅ Distance formula (km)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    let dLat = (lat2 - lat1) * Math.PI / 180;
    let dLon = (lon2 - lon1) * Math.PI / 180;
    let a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}