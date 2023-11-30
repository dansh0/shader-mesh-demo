import * as THREE from 'three'
import { OrbitControls } from './jsm/controls/OrbitControls.js'
import Stats from './jsm/libs/stats.module.js'
import { GUI } from './jsm/libs/lil-gui.module.min.js'

const scene = new THREE.Scene()

let width = window.innerWidth;
let height = window.innerHeight;
let dpmm = 10; // dots per millimeter
const camera = new THREE.OrthographicCamera(-width/(2*dpmm), width/(2*dpmm), height/(2*dpmm), -height/(2*dpmm), 0, 200);
camera.position.set(0, -100, 0);
scene.add(camera);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);

const geometry = new THREE.BoxGeometry(10,10,10);
// const material = new THREE.ShaderMaterial({
//     uniforms: {},
//     vertexShader:
// });
const material = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    wireframe: true,
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

window.addEventListener(
    'resize',
    () => {
        width = window.innerWidth;
        height = window.innerHeight;
        camera.aspect = width/height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        render();
    },
    false
);

const stats = Stats();
document.body.appendChild(stats.dom);

// const gui = new GUI();
// const cubeFolder = gui.addFolder('Cube');
// cubeFolder.add(cube.scale, 'x', -5, 5);
// cubeFolder.add(cube.scale, 'y', -5, 5);
// cubeFolder.add(cube.scale, 'z', -5, 5);

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    render();
    stats.update();
}

function render() {
    renderer.render(scene, camera);
}

animate();
