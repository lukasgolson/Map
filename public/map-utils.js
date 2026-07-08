// Map coordinate projection, wrapping, and geometry math helpers

export function getWrappedLatLng(map, latlng) {
  if (!map || !map._loaded) return latlng;
  try {
    const centerLng = map.getCenter().lng;
    const diff = centerLng - latlng.lng;
    const wraps = Math.round(diff / 360.0);
    return L.latLng(latlng.lat, latlng.lng + (wraps * 360.0));
  } catch (e) {
    return latlng;
  }
}

export function getWrappedLatLngs(map, latlngs) {
  if (latlngs.length === 0) return [];
  if (!map || !map._loaded) return latlngs;
  try {
    const centerLng = map.getCenter().lng;
    const latest = latlngs[latlngs.length - 1];
    const diff = centerLng - latest.lng;
    const wraps = Math.round(diff / 360.0);
    const shift = wraps * 360.0;
    if (shift === 0) return latlngs;
    return latlngs.map(latlng => L.latLng(latlng.lat, latlng.lng + shift));
  } catch (e) {
    return latlngs;
  }
}

export function getDistanceKM(c1, c2) {
  const R = 6371.0; // Earth's radius in km
  const lat1 = c1.lat * Math.PI / 180;
  const lat2 = c2.lat * Math.PI / 180;
  const dLat = (c2.lat - c1.lat) * Math.PI / 180;
  const dLon = (c2.lng - c1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
            Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export function getBearing(c1, c2) {
  const lat1 = c1.lat * Math.PI / 180;
  const lat2 = c2.lat * Math.PI / 180;
  const dLon = (c2.lng - c1.lng) * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

export function snapToTransitAngles(coords) {
  if (coords.length === 0) return [];
  
  const snapped = [];
  snapped.push(L.latLng(coords[0].lat, coords[0].lng));
  
  for (let i = 1; i < coords.length; i++) {
    const prev = snapped[i - 1];
    const curr = coords[i];
    
    let dx = curr.lng - prev.lng;
    let dy = curr.lat - prev.lat;
    
    let snappedLng = curr.lng;
    let snappedLat = curr.lat;
    
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    if (absDx > 2.2 * absDy) {
      snappedLat = prev.lat;
    } else if (absDy > 2.2 * absDx) {
      snappedLng = prev.lng;
    } else {
      const step = (absDx + absDy) / 2;
      snappedLng = prev.lng + step * Math.sign(dx);
      snappedLat = prev.lat + step * Math.sign(dy);
    }
    
    snapped.push(L.latLng(snappedLat, snappedLng));
  }
  
  return snapped;
}

export function getBezierSplinePoints(points, stepsPerSegment = 12) {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const result = [];
    const p0 = points[0];
    const p1 = points[1];
    for (let i = 0; i <= stepsPerSegment; i++) {
      const t = i / stepsPerSegment;
      result.push(L.latLng(
        p0.lat + (p1.lat - p0.lat) * t,
        p0.lng + (p1.lng - p0.lng) * t
      ));
    }
    return result;
  }
  
  const n = points.length - 1;
  const A = new Array(n);
  const B = new Array(n);
  const alpha = 0.18; // tension parameter for control points
  
  for (let i = 0; i < n; i++) {
    const pPrev = i > 0 ? points[i - 1] : points[i];
    const pCurr = points[i];
    const pNext = points[i + 1];
    const pNextNext = i + 2 < points.length ? points[i + 2] : points[i + 1];
    
    A[i] = L.latLng(
      pCurr.lat + alpha * (pNext.lat - pPrev.lat),
      pCurr.lng + alpha * (pNext.lng - pPrev.lng)
    );
    
    B[i] = L.latLng(
      pNext.lat - alpha * (pNextNext.lat - pCurr.lat),
      pNext.lng - alpha * (pNextNext.lng - pCurr.lng)
    );
  }
  
  const splinePoints = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = A[i];
    const p2 = B[i];
    const p3 = points[i + 1];
    
    const limit = (i === n - 1) ? stepsPerSegment : stepsPerSegment - 1;
    for (let j = 0; j <= limit; j++) {
      const t = j / stepsPerSegment;
      const t1 = 1 - t;
      
      const lat = t1*t1*t1*p0.lat + 3*t1*t1*t*p1.lat + 3*t1*t*t*p2.lat + t*t*t*p3.lat;
      const lng = t1*t1*t1*p0.lng + 3*t1*t1*t*p1.lng + 3*t1*t*t*p2.lng + t*t*t*p3.lng;
      
      splinePoints.push(L.latLng(lat, lng));
    }
  }
  
  return splinePoints;
}
