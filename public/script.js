(() => {
  "use strict";
  let map = null, marker = null, routeControl = null, selectedLat = null, selectedLng = null;
  let currentPosition = null, watchId = null, locationWatchStarted = false;
  const alertedTaskIds = new Set();
  let arrivalInProgress = false;
  const $ = id => document.getElementById(id);

  function status(message, error = false) {
    const node = $("statusMessage");
    if (node) node.textContent = message;
    $("statusDot")?.classList.toggle("error", error);
  }
  function validCoords(lat, lng) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
      Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
  }
  function chooseLocation(lat, lng) {
    if (!validCoords(lat, lng)) return;
    selectedLat = Number(lat); selectedLng = Number(lng);
    marker?.setLatLng([selectedLat, selectedLng]);
  }
  function speak(text) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find(v => (v.lang || "").toLowerCase().startsWith("en-in"));
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  async function fetchTasks() {
    const tasks = await api("/tasks");
    if (!Array.isArray(tasks)) throw new Error("The server returned an invalid task list.");
    return tasks;
  }
  function distanceKm(lat1, lng1, lat2, lng2) {
    if (![lat1,lng1,lat2,lng2].every(v => Number.isFinite(Number(v)))) return Infinity;
    const rad = n => Number(n) * Math.PI / 180;
    const dLat = rad(lat2-lat1), dLng = rad(lng2-lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
    return 6371 * 2 * Math.atan2(Math.sqrt(Math.max(0,a)), Math.sqrt(Math.max(0,1-a)));
  }
  function renderTasks(tasks) {
    const list = $("taskList"); list.replaceChildren();
    $("taskCount").textContent = String(tasks.length);
    if (!tasks.length) {
      const empty = document.createElement("p"); empty.className = "empty-state";
      empty.textContent = "Nothing on your list yet. Add a task and choose its spot on the map.";
      list.appendChild(empty); return;
    }
    tasks.forEach(task => {
      const [id, title, lat, lng] = task;
      const hasCoords = validCoords(lat, lng);
      const row = document.createElement("article"); row.className = "task";
      const main = document.createElement("div"); main.className = "task-main";
      const pin = document.createElement("span"); pin.className = "task-pin"; pin.textContent = "⌖"; pin.setAttribute("aria-hidden","true");
      const info = document.createElement("div");
      const name = document.createElement("div"); name.className = "task-title"; name.textContent = String(title ?? "Untitled task");
      const meta = document.createElement("div"); meta.className = "task-meta";
      meta.textContent = hasCoords ? (currentPosition ? `${distanceKm(...currentPosition, lat, lng).toFixed(1)} km away` : "Location saved") : "No location saved";
      info.append(name,meta); main.append(pin,info);
      const actions = document.createElement("div"); actions.className = "task-actions";
      if (hasCoords) {
        const route = document.createElement("button"); route.type = "button"; route.className = "route-button"; route.textContent = "Route";
        route.addEventListener("click", () => showRoute(Number(lat), Number(lng))); actions.appendChild(route);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-button"; remove.textContent = "Delete";
      remove.addEventListener("click", () => deleteTask(id, remove)); actions.appendChild(remove);
      row.append(main,actions); list.appendChild(row);
    });
  }
  async function loadTasks() {
    $("refreshButton").disabled = true;
    try {
      let tasks = await fetchTasks();
      if (currentPosition) tasks.sort((a,b) => distanceKm(...currentPosition,a[2],a[3]) - distanceKm(...currentPosition,b[2],b[3]));
      renderTasks(tasks);
    } catch (e) {
      const list = $("taskList"); list.replaceChildren();
      const message = document.createElement("p"); message.className = "empty-state"; message.textContent = e.message || "Unable to load tasks.";
      list.appendChild(message); $("taskCount").textContent = "—";
    } finally { $("refreshButton").disabled = false; }
  }
  async function saveTask(event) {
    event?.preventDefault();
    const title = $("taskName").value.trim();
    if (!title) { status("Enter a task name first.",true); $("taskName").focus(); return; }
    if (title.length > 200) { status("Task names must be 200 characters or fewer.",true); return; }
    if (selectedLat === null || selectedLng === null) { status("Choose a task location by clicking the map or dragging the pin.",true); return; }
    const button = $("addTaskButton"); button.disabled = true;
    try {
      await api("/add",{method:"POST",body:JSON.stringify({title,lat:selectedLat,lng:selectedLng})});
      $("taskName").value = ""; status("Task saved successfully."); await loadTasks();
    } catch(e) { status(e.message || "Could not save task.",true); }
    finally { button.disabled = false; }
  }
  async function deleteTask(id, button) {
    if (button) button.disabled = true;
    try {
      await api(`/delete/${encodeURIComponent(id)}`,{method:"DELETE"});
      alertedTaskIds.delete(Number(id)); status("Task deleted."); await loadTasks();
    } catch(e) { status(e.message || "Could not delete task.",true); if(button) button.disabled = false; }
  }
  async function searchLocation() {
    const query = $("searchBox").value.trim();
    if (!query) { status("Enter a place or address to search.",true); $("searchBox").focus(); return; }
    const button = $("searchButton"); button.disabled = true; status("Searching for location…");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const response = await fetch(url,{headers:{"Accept-Language":"en"}});
      if (!response.ok) throw new Error("The location search service is temporarily unavailable.");
      const results = await response.json();
      if (!Array.isArray(results) || !results.length) throw new Error("Location not found. Try a more specific search.");
      const result = results[0], lat = Number(result.lat), lng = Number(result.lon);
      if (!validCoords(lat,lng)) throw new Error("The location search returned invalid coordinates.");
      chooseLocation(lat,lng); map.setView([lat,lng],16); marker?.openPopup();
      status(`Location selected: ${result.display_name || query}`);
    } catch(e) { status(e.message || "Location search failed.",true); }
    finally { button.disabled = false; }
  }
  function showRoute(lat,lng) {
    chooseLocation(lat,lng);
    if (!map) return;
    if (!currentPosition) { map.setView([lat,lng],15); status("Task location shown. Allow location access to get a route."); return; }
    if (!L.Routing) { map.setView([lat,lng],15); status("Routing is unavailable. The task pin is shown on the map.",true); return; }
    if (routeControl) map.removeControl(routeControl);
    routeControl = L.Routing.control({
      waypoints:[L.latLng(...currentPosition),L.latLng(lat,lng)], routeWhileDragging:false,
      show:false, addWaypoints:false, createMarker:()=>null
    }).addTo(map);
    map.setView([lat,lng],14);
  }
  function initMap() {
    if (!window.L) { status("Map libraries failed to load. Check your internet connection and refresh.",true); return; }
    const fallback = [20.5937,78.9629];
    map = L.map("map").setView(fallback,5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
    marker = L.marker(fallback,{draggable:true}).addTo(map).bindPopup("Selected task location");
    marker.on("dragend",e=>{const p=e.target.getLatLng();chooseLocation(p.lat,p.lng);});
    map.on("click",e=>chooseLocation(e.latlng.lat,e.latlng.lng));
    if (!navigator.geolocation) { chooseLocation(...fallback); status("Geolocation is not supported. Click the map to select a location."); loadTasks(); return; }
    navigator.geolocation.getCurrentPosition(p=>{
      currentPosition=[p.coords.latitude,p.coords.longitude]; map.setView(currentPosition,15); chooseLocation(...currentPosition);
      status("Location found. Click the map or move the pin to choose a task destination."); loadTasks(); startWatch();
    },e=>{
      chooseLocation(...fallback);
      const messages={1:"Location permission denied. You can still choose a location on the map.",2:"Your location is unavailable. Choose a location on the map.",3:"Location request timed out. Choose a location on the map."};
      status(messages[e.code] || "Could not get your location. Choose a location on the map."); loadTasks();
    },{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }
  function startWatch() {
    if (locationWatchStarted || !navigator.geolocation) return;
    locationWatchStarted = true;
    watchId = navigator.geolocation.watchPosition(async p=>{
      currentPosition=[p.coords.latitude,p.coords.longitude];
      loadTasks();
      if (arrivalInProgress) return;
      try {
        const tasks=await fetchTasks();
        const candidates=tasks.filter(t=>validCoords(t[2],t[3])).sort((a,b)=>distanceKm(...currentPosition,a[2],a[3])-distanceKm(...currentPosition,b[2],b[3]));
        const nearest=candidates[0];
        if (!nearest || distanceKm(...currentPosition,nearest[2],nearest[3]) > .1 || alertedTaskIds.has(Number(nearest[0]))) return;
        alertedTaskIds.add(Number(nearest[0])); arrivalInProgress=true;
        speak(`You are near ${nearest[1]}`);
        const complete=window.confirm(`You are within 100 metres of "${nearest[1]}". Mark it complete and delete it?`);
        if (complete) await deleteTask(nearest[0]);
      } catch(_) { /* transient errors should not terminate GPS watch */ }
      finally { arrivalInProgress=false; }
    },e=>{if(e.code===1)status("Location permission was denied. Saved tasks remain available.",true);},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
  }

  window.addEventListener("DOMContentLoaded",()=>{
    $("taskForm").addEventListener("submit",saveTask);
    $("searchButton").addEventListener("click",searchLocation);
    $("searchBox").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchLocation();}});
    $("refreshButton").addEventListener("click",loadTasks);
    $("locateButton").addEventListener("click",()=>{
      if(!currentPosition){status("Current location is not available yet. Check browser location permission.",true);return;}
      map?.setView(currentPosition,16);
    });
    initMap(); loadTasks();
  });
  window.addEventListener("beforeunload",()=>{if(watchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watchId);if("speechSynthesis"in window)window.speechSynthesis.cancel();});
})();
