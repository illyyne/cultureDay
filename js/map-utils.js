function initMap(containerId, lat, lng) {
  const map = L.map(containerId).setView([lat, lng], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 200);

  return map;
}

function addMarker(map, lat, lng, label) {
  const marker = L.marker([lat, lng]).addTo(map);
  if (label) marker.bindPopup(label).openPopup();
  map.flyTo([lat, lng], 6, { duration: 1.5 });
  return marker;
}
