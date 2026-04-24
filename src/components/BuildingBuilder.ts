// BuildingBuilder.ts
import * as THREE from "three";
import * as OBC from "@thatopen/components";

export class BuildingBuilder {

  constructor(
    private world: OBC.World,
    private info: any
  ) {}

  build() {
    this.createFloors();
    this.createColumns();
  }

  private createFloors() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xdedede });

    for (let i = 0; i < this.info.numberOfFloors; i++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(
          this.info.width,
          this.info.floorThickness,
          this.info.length
        ),
        mat
      );

      slab.position.y = i * this.info.floorHeight;
      slab.receiveShadow = true;
      slab.castShadow = true;

      this.world.scene.three.add(slab);
    }
  }

  private createColumns() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 });

    const halfW = this.info.width / 2;
    const halfL = this.info.length / 2;

    for (let floor = 0; floor < this.info.numberOfFloors; floor++) {
      const baseY = floor * this.info.floorHeight;
      const height = this.info.floorHeight;

      // Exterior columns
      for (let x = -halfW; x <= halfW; x += this.info.columnWidthDistance) {
        this.createColumn(x, -halfL, baseY, height, mat, true);
        this.createColumn(x,  halfL, baseY, height, mat, true);
      }

      for (let z = -halfL; z <= halfL; z += this.info.columnLengthDistance) {
        this.createColumn(-halfW, z, baseY, height, mat, true);
        this.createColumn( halfW, z, baseY, height, mat, true);
      }

      // Interior columns
      for (
        let x = -halfW + this.info.columnWidthDistance;
        x < halfW;
        x += this.info.columnWidthDistance
      ) {
        for (
          let z = -halfL + this.info.columnLengthDistance;
          z < halfL;
          z += this.info.columnLengthDistance
        ) {
          this.createColumn(x, z, baseY, height, mat, false);
        }
      }
    }
  }

  private createColumn(
    x: number,
    z: number,
    baseY: number,
    height: number,
    mat: THREE.Material,
    exterior: boolean
  ) {
    const w = exterior
      ? this.info.exteriorColumnWidth
      : this.info.interiorColumnWidth;

    const d = exterior
      ? this.info.exteriorColumnLength
      : this.info.interiorColumnLength;

    const column = new THREE.Mesh(
      new THREE.BoxGeometry(w, height, d),
      mat
    );

    column.position.set(x, baseY + height / 2, z);
    column.castShadow = true;
    column.receiveShadow = true;

    this.world.scene.three.add(column);
  }
}
