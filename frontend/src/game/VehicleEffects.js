import * as THREE from 'three';

export class VehicleEffects {
  constructor(scene, capacity = 64) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.particles = Array.from({ length: this.capacity }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      color: new THREE.Color()
    }));
    this.nextParticle = 0;
    this.exhaustTimer = 0;
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3)
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3)
    );
    this.geometry.setDrawRange(0, this.capacity);
    this.material = new THREE.PointsMaterial({
      size: 0.32,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(position, velocity, color, lifetime = 0.42) {
    if (this.capacity === 0) return;
    const particle = this.particles[this.nextParticle];
    this.nextParticle = (this.nextParticle + 1) % this.capacity;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.set(color);
    particle.maxLife = lifetime;
    particle.life = lifetime;
  }

  emitNitro(car, delta, color = 0x00eaff) {
    if (this.capacity === 0) return;
    this.exhaustTimer -= delta;
    if (this.exhaustTimer > 0) return;
    this.exhaustTimer = 0.045;
    const rear = new THREE.Vector3(0, 0.46, 2.25)
      .applyQuaternion(car.quaternion)
      .add(car.position);
    for (const side of [-0.2, 0.2]) {
      const position = rear.clone().add(
        new THREE.Vector3(side, 0, 0).applyQuaternion(car.quaternion)
      );
      const velocity = new THREE.Vector3(0, 0.55, 2.1)
        .applyQuaternion(car.quaternion);
      this.spawn(position, velocity, color, 0.34);
    }
  }

  emitImpact(position, color = 0xffc247) {
    const count = Math.min(12, this.capacity);
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / count;
      this.spawn(
        position,
        new THREE.Vector3(
          Math.cos(angle) * 2.2,
          0.8 + (index % 3) * 0.55,
          Math.sin(angle) * 2.2
        ),
        color,
        0.52
      );
    }
  }

  update(delta) {
    for (let index = 0; index < this.capacity; index += 1) {
      const particle = this.particles[index];
      const offset = index * 3;
      if (particle.life <= 0) {
        this.positions[offset + 1] = -10000;
        this.colors[offset] = 0;
        this.colors[offset + 1] = 0;
        this.colors[offset + 2] = 0;
        continue;
      }
      particle.life = Math.max(0, particle.life - delta);
      particle.position.addScaledVector(particle.velocity, delta);
      particle.velocity.y -= 1.8 * delta;
      const fade = particle.life / particle.maxLife;
      this.positions[offset] = particle.position.x;
      this.positions[offset + 1] = particle.position.y;
      this.positions[offset + 2] = particle.position.z;
      this.colors[offset] = particle.color.r * fade;
      this.colors[offset + 1] = particle.color.g * fade;
      this.colors[offset + 2] = particle.color.b * fade;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
    this.particles.length = 0;
  }
}
