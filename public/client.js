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
    #define MAX_STEPS 10000
    #define MAX_DIST 200.
    #define MIN_DIST 0.01
    #define DOTS_PER_MM 10.
    #define NORM_EPS 0.001
    #define PI 3.141592

    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;
    uniform sampler2D uFrontTexture;
    uniform sampler2D uBackTexture;
    uniform vec3 uCameraPos;
    uniform vec3 uCameraDir;
    uniform vec2 uCameraSize;

    // PARAMS
    float scale = 1.; // Geo scale
    vec3 objCol = vec3(1.0, 1.0, 1.0); // Base material color


    // GEOMETRY

    // Gyroid Beam
    float distGyroidBeam(vec3 point, float gyroidFactor) {
        point *= scale;
        return (dot(sin(point), cos(point.zxy))) + gyroidFactor;
    }

    // Sphere
    float distSphere(vec3 point, vec3 center, float radius) {
        vec3 transPoint = (point - center);
        return length(transPoint) - radius;
    }

    // GEOMETRY COMBINATIONS

    // Distance Function Combine
    float distCombine( vec3 position ) {
        
        // geometry
        float dist = distGyroidBeam( position, 0.8);
        // float dist = distSphere(position, vec3(0.0), 5.);
        return dist;
    }     

        
    // RAY TOOLS

    // Ray March
    float marcher(vec3 position, vec3 direction) {
        float dist = 0.;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float safeMarchDist = distCombine(position);
            if (safeMarchDist > MIN_DIST && dist < MAX_DIST) {
                position += safeMarchDist * direction;
                dist += safeMarchDist;
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Camera Fragment Position (Orthographic)
    vec3 orthoFragPos(vec2 fragCoord) {
        vec3 initialUp = vec3(0.0, 1.0, 0.0);
        if (uCameraDir.x == 0.0 && uCameraDir.z == 0.0 && uCameraDir.y != 0.0) {
            initialUp = vec3(0.0, 0.0, 1.0);
        }
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        vec2 offset = (uv * uCameraSize) - (uCameraSize * 0.5);
        vec3 rightChange = normalize(cross(uCameraDir, initialUp));
        vec3 upChange = normalize(cross(rightChange, uCameraDir));
        vec3 worldOffset = offset.x * rightChange + offset.y * upChange;
        return uCameraPos + worldOffset;
        // return vec3(offset/50., 0.0);
    }

    void main() {
        
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        vec4 frontDepth = texture2D( uFrontTexture, uv);
        vec4 backDepth = texture2D( uBackTexture, uv);
        
        vec3 fragPos = orthoFragPos(gl_FragCoord.xy);
        // gl_FragColor = vec4(fragPos/50., 1.0);

        vec3 col = vec3(0.0);

        // Ray March
        float objDist = marcher(fragPos.xyz, uCameraDir);
        vec3 objPos = fragPos + uCameraDir * objDist;
        
        if (objDist < MAX_DIST) {
            col = vec3(1.0);
            
        }
        
        gl_FragColor = vec4(vec3(col), 1.0);
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

// get camera direction
const cameraDir = new THREE.Vector3();
camera.getWorldDirection(cameraDir)
console.log(cameraDir)

// Shader Material
const material = new THREE.ShaderMaterial({
    uniforms: {
        'uFrontTexture': { 'value': renderTargetFront.texture },
        'uBackTexture': { 'value': renderTargetBack.texture },
        'uCameraPos': { 'value': camera.position },
        'uCameraDir': { 'value': cameraDir },
        'uCameraSize': { 'value': new THREE.Vector2(width/dpmm, height/dpmm)}
    },
    vertexShader: vert,
    fragmentShader: frag
})
console.log(material.uniforms)
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
