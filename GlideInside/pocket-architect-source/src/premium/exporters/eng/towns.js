// Approximate town centres (NSW and Queensland) so the locality map can say which way the nearest town centre lies. Straight line
// distance and bearing only: it is orientation, not a route. Coordinates are rounded centres, good to about a kilometre.

const TOWNS = [
  ['Tamworth', 150.930, -31.091], ['Gunnedah', 150.255, -30.979], ['Armidale', 151.670, -30.512], ['Moree', 149.847, -29.462],
  ['Narrabri', 149.783, -30.326], ['Inverell', 151.110, -29.775], ['Glen Innes', 151.740, -29.735], ['Tenterfield', 152.020, -29.048],
  ['Quirindi', 150.514, -31.507], ['Scone', 150.867, -32.050], ['Muswellbrook', 150.889, -32.265], ['Singleton', 151.169, -32.570],
  ['Maitland', 151.553, -32.733], ['Newcastle', 151.776, -32.927], ['Cessnock', 151.356, -32.833], ['Port Macquarie', 152.908, -31.433],
  ['Kempsey', 152.833, -31.083], ['Macksville', 152.919, -30.711], ['Bellingen', 152.900, -30.450], ['Coffs Harbour', 153.116, -30.296],
  ['Grafton', 152.933, -29.690], ['Lismore', 153.278, -28.813], ['Ballina', 153.565, -28.867], ['Casino', 153.050, -28.866],
  ['Tweed Heads', 153.540, -28.176], ['Taree', 152.460, -31.905], ['Forster', 152.517, -32.180], ['Dubbo', 148.601, -32.243],
  ['Wellington', 148.940, -32.557], ['Mudgee', 149.584, -32.590], ['Orange', 149.101, -33.283], ['Bathurst', 149.577, -33.419],
  ['Lithgow', 150.154, -33.483], ['Parkes', 148.177, -33.138], ['Wagga Wagga', 147.369, -35.108], ['Albury', 146.913, -36.080],
  ['Goulburn', 149.719, -34.752], ['Nowra', 150.600, -34.880], ['Wollongong', 150.893, -34.425], ['Sydney', 151.209, -33.869],
  ['Canberra', 149.130, -35.280], ['Queanbeyan', 149.232, -35.354], ['Broken Hill', 141.467, -31.957],
  ['Brisbane', 153.026, -27.470], ['Gold Coast', 153.430, -28.002], ['Toowoomba', 151.950, -27.561], ['Ipswich', 152.761, -27.617],
  ['Gympie', 152.665, -26.190], ['Maroochydore', 153.100, -26.656], ['Hervey Bay', 152.840, -25.290], ['Bundaberg', 152.349, -24.866],
  ['Gladstone', 151.257, -23.843], ['Rockhampton', 150.512, -23.379], ['Emerald', 148.167, -23.527], ['Mackay', 149.186, -21.142],
  ['Bowen', 148.243, -20.011], ['Townsville', 146.818, -19.259], ['Charters Towers', 146.260, -20.075], ['Ingham', 146.159, -18.650],
  ['Innisfail', 146.030, -17.524], ['Cairns', 145.770, -16.919], ['Atherton', 145.476, -17.265], ['Port Douglas', 145.464, -16.483],
  ['Warwick', 152.034, -28.215], ['Mount Isa', 139.493, -20.725],
];

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const rad = (d) => (d * Math.PI) / 180;

export function distanceBearing(lon1, lat1, lon2, lat2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  const bearingDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { km, bearingDeg };
}

/** The nearest listed town centre within `maxKm` of the point: { name, km, bearingDeg, compass } or null. */
export function nearestTown(lon, lat, maxKm = 120) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  let best = null;
  for (const [name, tl, ta] of TOWNS) {
    const d = distanceBearing(lon, lat, tl, ta);
    if (d.km <= maxKm && (!best || d.km < best.km)) best = { name, ...d };
  }
  return best ? { ...best, compass: COMPASS16[Math.round(best.bearingDeg / 22.5) % 16] } : null;
}
