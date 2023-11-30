import * as THREE from 'three'
import { OrbitControls } from './jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from './jsm/geometries/RoundedBoxGeometry.js'
import Stats from './jsm/libs/stats.module.js'
import { GUI } from './jsm/libs/lil-gui.module.min.js'

const vert = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;

    void main() {
        vNormal = normal;
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vWorldPos = vec3(mvPosition);
        gl_Position = projectionMatrix * mvPosition;
        vProjPos = vec3(gl_Position);
    }
`

const frag = `
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;
    uniform sampler2D uFrontTexture;
    uniform sampler2D uBackTexture;

    void main() {
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        vec4 frontDepth = texture2D( uFrontTexture, uv);
        vec4 backDepth = texture2D( uBackTexture, uv);
       
    }
`

const scene = new THREE.Scene()

let width = window.innerWidth
let height = window.innerHeight
// const camera = new THREE.PerspectiveCamera( 10, window.innerWidth / window.innerHeight, 1, 2000 )
const dpmm = 20
const camera = new THREE.OrthographicCamera(-width/(2*dpmm), width/(2*dpmm), height/(2*dpmm), -height/(2*dpmm), 0, 100)
camera.position.set(25, 25, 25)
scene.add(camera)

const renderer = new THREE.WebGLRenderer()
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.autoClear = false;
document.body.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)

// Render Targets and Secondary Scenes
const renderTargetFront = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })
const renderTargetBack = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })
const frontScene = new THREE.Scene()
const backScene = new THREE.Scene()

// Model
const geometry = new RoundedBoxGeometry(20, 20, 20, 10, 5)

// Depth Renders
const depthMatFront = new THREE.MeshDepthMaterial()
depthMatFront.side = THREE.FrontSide
const depthMeshFront = new THREE.Mesh(geometry, depthMatFront)
frontScene.add(depthMeshFront);

const depthMatBack = new THREE.MeshDepthMaterial()
depthMatBack.side = THREE.BackSide
const depthMeshBack = new THREE.Mesh(geometry, depthMatBack)
backScene.add(depthMeshBack);

// Shader Material
const material = new THREE.ShaderMaterial({
    uniforms: {
        'uFrontTexture': {'value':renderTargetFront.texture},
        'uBackTexture': {'value':renderTargetBack.texture}
    },
    vertexShader: vert,
    fragmentShader: frag
})
const cube = new THREE.Mesh(geometry, material)
scene.add(cube)

window.addEventListener(
    'resize',
    () => {
        width = window.innerWidth
        height = window.innerHeight
        camera.aspect = width/height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
        render()
    },
    false
)

const stats = Stats()
document.body.appendChild(stats.dom)

// const gui = new GUI()
// const cubeFolder = gui.addFolder('Cube')
// cubeFolder.add(cube.scale, 'x', -5, 5)
// cubeFolder.add(cube.scale, 'y', -5, 5)
// cubeFolder.add(cube.scale, 'z', -5, 5)

function animate() {
    requestAnimationFrame(animate)
    controls.update()
    render()
    stats.update()
}

function render() {
    
    // render targets
    renderer.setRenderTarget(renderTargetFront)
    renderer.clear()
    renderer.render(frontScene, camera)

    renderer.setRenderTarget(renderTargetBack)
    renderer.clear()
    renderer.render(backScene, camera)

    // render scene
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(scene, camera)
}

animate()
