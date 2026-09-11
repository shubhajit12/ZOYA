import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('A:\\whitehat-jr\\Downloads\\json-for-animation-of-zoya\\Breathing_Idle_keyframes.json', 'utf8'));

console.log(`Name: ${data.name}`);
console.log(`Duration ticks: ${data.duration_ticks}`);
console.log(`Ticks per second: ${data.ticks_per_second}`);
console.log(`Duration seconds: ${data.duration_seconds}`);
console.log(`Channels: ${data.num_channels}`);
console.log('');

for (const ch of data.channels) {
  const rotKeys = ch.rotation_keys || [];
  const posKeys = ch.position_keys || [];
  const scaleKeys = ch.scale_keys || [];
  
  // Check if rotation actually varies
  let rotVaries = false;
  if (rotKeys.length > 1) {
    const first = rotKeys[0];
    for (let i = 1; i < rotKeys.length; i++) {
      if (Math.abs(rotKeys[i].x - first.x) > 0.0001 ||
          Math.abs(rotKeys[i].y - first.y) > 0.0001 ||
          Math.abs(rotKeys[i].z - first.z) > 0.0001 ||
          Math.abs(rotKeys[i].w - first.w) > 0.0001) {
        rotVaries = true;
        break;
      }
    }
  }
  
  // Check if position actually varies
  let posVaries = false;
  if (posKeys.length > 1) {
    const first = posKeys[0];
    for (let i = 1; i < posKeys.length; i++) {
      if (Math.abs(posKeys[i].x - first.x) > 0.0001 ||
          Math.abs(posKeys[i].y - first.y) > 0.0001 ||
          Math.abs(posKeys[i].z - first.z) > 0.0001) {
        posVaries = true;
        break;
      }
    }
  }
  
  // Compute rotation delta range
  let maxRotDelta = 0;
  if (rotKeys.length > 1 && rotVaries) {
    const q0 = rotKeys[0];
    for (const k of rotKeys) {
      // Simple quaternion distance
      const dx = k.x - q0.x, dy = k.y - q0.y, dz = k.z - q0.z, dw = k.w - q0.w;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz + dw*dw);
      if (dist > maxRotDelta) maxRotDelta = dist;
    }
  }
  
  // Convert to euler range
  let eulerRange = 'N/A';
  if (rotVaries && rotKeys.length > 1) {
    // Sample first/last/middle to get euler range
    const toEuler = (q) => {
      // Approximate euler from quat
      const sinr = 2 * (q.w * q.x + q.y * q.z);
      const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
      const x = Math.atan2(sinr, cosr);
      const sinp = 2 * (q.w * q.y - q.z * q.x);
      const y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
      const siny = 2 * (q.w * q.z + q.x * q.y);
      const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
      const z = Math.atan2(siny, cosy);
      return [x * 180/Math.PI, y * 180/Math.PI, z * 180/Math.PI];
    };
    
    // Find min/max euler across all keyframes
    let minE = [Infinity, Infinity, Infinity];
    let maxE = [-Infinity, -Infinity, -Infinity];
    for (const k of rotKeys) {
      const e = toEuler(k);
      for (let i = 0; i < 3; i++) {
        minE[i] = Math.min(minE[i], e[i]);
        maxE[i] = Math.max(maxE[i], e[i]);
      }
    }
    eulerRange = `X:[${minE[0].toFixed(1)}..${maxE[0].toFixed(1)}] Y:[${minE[1].toFixed(1)}..${maxE[1].toFixed(1)}] Z:[${minE[2].toFixed(1)}..${maxE[2].toFixed(1)}]`;
  }
  
  const status = [];
  if (rotVaries) status.push(`ROT VARIES (${rotKeys.length} keys, maxDelta=${maxRotDelta.toFixed(4)}, euler=${eulerRange})`);
  else status.push(`ROT STATIC (${rotKeys.length} keys)`);
  if (posVaries) status.push(`POS VARIES (${posKeys.length} keys)`);
  else status.push(`POS STATIC (${posKeys.length} keys)`);
  
  console.log(`${ch.bone}: ${status.join(' | ')}`);
}
