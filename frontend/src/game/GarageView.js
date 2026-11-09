import * as THREE from 'three';
import { createCar } from './Car.js';
import { getVehicle, VEHICLES } from './VehicleCatalog.js';
import { applyRendererQuality, getQualityProfile } from './QualityProfiles.js';

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) material.dispose();
  });
}

export class GarageView {
  constructor(container, profile, {
    onProfileChange = () => {},
    availableVehicleIds = VEHICLES.map(({ id }) => id)
  } = {}) {
    this.container = container;
    this.profile = profile;
    this.onProfileChange = onProfileChange;
    this.availableVehicleIds = new Set(availableVehicleIds);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070817);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.camera.position.set(6, 4.2, 7);
    this.camera.lookAt(0, 0.7, 0);
    this.renderer = new THREE.WebGLRenderer({
      antialias: profile.quality !== 'low',
      alpha: false
    });
    const quality = applyRendererQuality(this.renderer, profile.quality);
    this.container.replaceChildren(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xb9e8ff, 0x170b35, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(4, 8, 5);
    key.castShadow = quality.shadows;
    this.scene.add(key);
    const rim = new THREE.PointLight(0x00eaff, 75, 22);
    rim.position.set(-5, 3, -3);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 64),
      new THREE.MeshStandardMaterial({
        color: 0x111329,
        metalness: 0.75,
        roughness: 0.28
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(2.8, 3.1, 0.25, 64),
      new THREE.MeshStandardMaterial({
        color: 0x24233c,
        metalness: 0.85,
        roughness: 0.24,
        emissive: 0x111735
      })
    );
    platform.position.y = 0.04;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.9, 0.04, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x00eaff })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    this.scene.add(ring);

    this.vehicleModel = null;
    this.rotation = 0;
    this.targetRotation = 0;
    this.zoom = 8.3;
    this.dragPointer = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.onPointerDown = (event) => {
      this.dragPointer = event.clientX;
      this.renderer.domElement.setPointerCapture(event.pointerId);
    };
    this.onPointerMove = (event) => {
      if (this.dragPointer === null) return;
      const difference = event.clientX - this.dragPointer;
      this.dragPointer = event.clientX;
      this.targetRotation += difference * 0.009;
    };
    this.onPointerUp = () => {
      this.dragPointer = null;
    };
    this.onWheel = (event) => {
      event.preventDefault();
      this.zoom = THREE.MathUtils.clamp(
        this.zoom + Math.sign(event.deltaY) * 0.65,
        5.2,
        11
      );
    };
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, {
      passive: false
    });

    this.populateVehicleList();
    this.selectVehicle(profile.vehicleId, false);
    this.resize();
    this.lastTime = performance.now();
    this.running = true;
    this.animationFrame = requestAnimationFrame((time) => this.animate(time));
  }

  populateVehicleList() {
    const list = this.container.parentElement?.querySelector('#garageVehicleList');
    if (!list) return;
    list.innerHTML = VEHICLES
      .filter(({ id }) => this.availableVehicleIds.has(id))
      .map((vehicle) => `
      <button class="garage-vehicle-card" data-garage-vehicle="${vehicle.id}">
        <span class="garage-swatch" style="--vehicle-color:${vehicle.bodyColor}"></span>
        <strong>${vehicle.name}</strong>
        <small>${vehicle.category}</small>
      </button>
    `).join('');
  }

  updateProfile(profile, persist = true) {
    this.profile = profile;
    this.selectVehicle(profile.vehicleId, false);
    if (persist) this.onProfileChange(this.profile);
  }

  selectVehicle(vehicleId, persist = true) {
    const vehicle = getVehicle(vehicleId);
    if (!this.availableVehicleIds.has(vehicle.id)) return;
    this.profile.vehicleId = vehicle.id;
    if (this.vehicleModel) {
      this.scene.remove(this.vehicleModel);
      disposeObject(this.vehicleModel);
    }
    this.vehicleModel = createCar(vehicle.id, {
      customization: this.profile.customization
    });
    this.vehicleModel.position.y = 0;
    this.scene.add(this.vehicleModel);
    this.container.parentElement?.querySelectorAll('[data-garage-vehicle]')
      .forEach((button) => {
        button.classList.toggle(
          'is-selected',
          button.dataset.garageVehicle === vehicle.id
        );
      });
    if (persist) this.onProfileChange(this.profile);
  }

  updateCustomization(customization) {
    this.profile.customization = customization;
    this.selectVehicle(this.profile.vehicleId, false);
    this.onProfileChange(this.profile);
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate(time) {
    if (!this.running) return;
    const delta = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.rotation += delta * 0.32;
    this.targetRotation += delta * 0.12;
    if (this.vehicleModel) {
      this.vehicleModel.rotation.y +=
        (this.targetRotation - this.vehicleModel.rotation.y) *
        (1 - Math.exp(-delta * 5));
      for (const wheel of this.vehicleModel.userData.wheelAssemblies ?? []) {
        wheel.spin.rotation.x -= delta * 0.08 / wheel.tireRadius;
      }
    }
    this.camera.position.set(
      Math.sin(this.rotation) * this.zoom * 0.68,
      3.8 + this.zoom * 0.07,
      Math.cos(this.rotation) * this.zoom * 0.68
    );
    this.camera.lookAt(0, 0.7, 0);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame((next) => this.animate(next));
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener(
      'pointerdown', this.onPointerDown
    );
    this.renderer.domElement.removeEventListener(
      'pointermove', this.onPointerMove
    );
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      'pointercancel', this.onPointerUp
    );
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container = null;
  }
}
