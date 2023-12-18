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
    #define NORM_EPS 0.01
    #define PI 3.141592
    #define TAU 6.283185

    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;
    uniform sampler2D uFrontTexture;
    uniform sampler2D uBackTexture;
    uniform vec3 uCameraPos;
    uniform vec2 uCameraSize;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uCameraZoom;
    uniform float uStepSize;
    uniform float uCellSize;
    uniform vec3 uColor;
    uniform float uLightTheta;
    uniform float uLightPhi;
    uniform vec3 uLightCol;

    // Declare Parameters
    float ambiStrength = 0.4; // Ambient light strength
    float diffStength = 0.4; // Diffuse light strength
    float specStrength = 0.2; // Specular light strength
    float specPow = 4.0; // Specular light power (spread)
    float gyroidFactor = 0.8; // Factor for shape of gyroid

    // Gyroid SDF
    float distGyroidBeam(vec3 point, float scale) {
        point *= scale;
        return (dot(sin(point), cos(point.zxy))) + gyroidFactor;
    }

    // Fixed Step Ray Marcher
    float fixedStepMarcher(vec3 position, vec3 direction, float near, float far, float scale) {
        float dist = near;
        position += near * direction;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float distToGeo = distGyroidBeam(position, scale);
            if (distToGeo > MIN_DIST && dist < MAX_DIST && dist < far) {
                position += uStepSize * direction;
                dist += uStepSize;
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Gyroid Beam Gradient (For Normal)
    vec3 tpmsGradBeam(vec3 position, float gyroidFactor, float scale) {
        vec3 change;
        change.x = (distGyroidBeam( position + vec3(NORM_EPS, 0, 0), scale) - distGyroidBeam( position - vec3(NORM_EPS, 0, 0), scale));
        change.y = (distGyroidBeam( position + vec3(0, NORM_EPS, 0), scale) - distGyroidBeam( position - vec3(0, NORM_EPS, 0), scale)); 
        change.z = (distGyroidBeam( position + vec3(0, 0, NORM_EPS), scale) - distGyroidBeam( position - vec3(0, 0, NORM_EPS), scale)); 
        return normalize( change );
    }

    // Camera Fragment Position (Orthographic)
    vec3 orthoFragPos(vec2 fragCoord, vec3 cameraDir, vec3 cameraPos) {

        // Ortho Pixel Pos Adj
        vec3 initialUp = vec3(0.0, 1.0, 0.0);
        if (cameraDir.x == 0.0 && cameraDir.z == 0.0 && cameraDir.y != 0.0) {
            initialUp = vec3(0.0, 0.0, 1.0);
        }
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        vec2 offset = (uv * uCameraSize / uCameraZoom) - (uCameraSize / uCameraZoom * 0.5);
        vec3 rightChange = normalize(cross(cameraDir, initialUp));
        vec3 upChange = normalize(cross(rightChange, cameraDir));
        vec3 worldOffset = offset.x * rightChange + offset.y * upChange;
        return cameraPos + worldOffset;
    }

    // RGBA Unpacking
    float unpackRGBAToDepth(vec4 color) {
        const vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);        float depth = dot(color, bitShifts);
        return depth;
    }

    void main() {

        // Determine Gyroid Geometry Scale
        float scale = 2.0*PI/uCellSize; // Geo scale

        // Find Front and Back Depth from Textures
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));

        float frontDepth = unpackRGBAToDepth(texture2D( uFrontTexture, uv));
        frontDepth = uCameraNear + (frontDepth)*uCameraFar;

        float backDepth = unpackRGBAToDepth(texture2D( uBackTexture, uv));
        backDepth = uCameraNear + (backDepth)*uCameraFar;
        
        // Find Camera Angle
        vec3 cameraDir = normalize(-uCameraPos);
        vec3 fragPos = orthoFragPos(gl_FragCoord.xy, cameraDir, uCameraPos);

        // Background is Black
        vec3 col = vec3(0.0);

        // Ray March to Find Object Position (Fixed Step)
        float objDist = fixedStepMarcher(fragPos.xyz, cameraDir, frontDepth, backDepth, scale);
        vec3 objPos = fragPos + cameraDir * objDist;

        // If Object Solve Lighting
        if (objDist < MAX_DIST && objDist < backDepth) {

            // Find Normal
            vec3 normal;
            if (objDist == frontDepth) {
                // Normal of Mesh Obj
                normal = vNormal;
            } else {
                // Normal of Gyroid
                normal = tpmsGradBeam(objPos, gyroidFactor, scale);
            }

            // Adjust Light Position
            float lRadius = 25.0;
            float lPhi = uLightPhi;
            float lTheta = uLightTheta;
            vec3 lightPos = vec3(lRadius*sin(lPhi)*cos(lTheta), lRadius*cos(lPhi), lRadius*sin(lPhi)*sin(lTheta));

            // Ambient Lighting
            vec3 ambiLight = vec3(1.) * ambiStrength;
            
            // Diffuse Lighting
            vec3 diffDir = normalize(lightPos - objPos);
            vec3 diffLight = uLightCol * diffStength * max(dot(normal, diffDir), 0.0);
            
            // Specular Lighting
            vec3 reflDir = reflect(-diffDir, normal);
            float specFact = pow(max(dot(-cameraDir, reflDir), 0.0), specPow);
            vec3 specLight = uLightCol * specStrength * specFact;
            
            // Phong Combined Lighting
            vec3 combLight = ambiLight + diffLight + specLight;
            col = combLight * uColor;
            
        }
        
        // Output Fragment
        gl_FragColor = vec4(vec3(col), 1.0);
    }
`

// JS Globals
let scene, frontScene, backScene
let renderTargetBack, renderTargetFront
let renderer, camera, controls, stats

// Calc Light Position
const lightPosition = (phi, theta) => {
    let radius = 25.0;
    return [
        radius*Math.sin(phi)*Math.cos(theta), 
        radius*Math.cos(phi),
        radius*Math.sin(phi)*Math.sin(theta)
    ]
}

// Setup
const Init = () => {
    
    // Consts
    const dpmm = 25 // dots per mm
    const cameraNear = 0 // mm
    const cameraFar = 100 // mm
    
    // Window Params
    let width = window.innerWidth
    let height = window.innerHeight
    
    // Scene, Renderer, Controls
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-width/(2*dpmm), width/(2*dpmm), height/(2*dpmm), -height/(2*dpmm), cameraNear, cameraFar)
    camera.position.set(25, 15, 20)
    scene.add(camera)

    renderer = new THREE.WebGLRenderer()
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.mouseButtons.RIGHT = '' // disable pan

    // Render Targets and Secondary Scenes
    renderTargetFront = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    })
    renderTargetBack = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    })
    frontScene = new THREE.Scene()
    backScene = new THREE.Scene()

    // Model
    let meshConfigs = {
        'geometry': 'sphere',
        'lightColor': [1.0, 1.0, 1.0]
    }
    const geometries = {
        box: new RoundedBoxGeometry(20, 20, 20, 10, 5),
        flatBox: new RoundedBoxGeometry(2, 20, 20, 10, 5),
        sphere: new THREE.SphereGeometry(10),
        torus: new THREE.TorusGeometry(10, 4, 16, 100),
    }
    let geometry = geometries[meshConfigs.geometry]

    // Depth Renders
    // Front depth will track where the fragment hits the mesh (first time only)
    const depthMatFront = new THREE.MeshDepthMaterial()
    depthMatFront.side = THREE.FrontSide
    depthMatFront.depthPacking = THREE.RGBADepthPacking // better, but needs to be unpacked in shader
    const depthMeshFront = new THREE.Mesh(geometry, depthMatFront)
    frontScene.add(depthMeshFront)

    // Back depth will track where the fragment exits the mesh (first time only)
    const depthMatBack = new THREE.MeshDepthMaterial()
    depthMatBack.side = THREE.BackSide
    depthMatBack.depthPacking = THREE.RGBADepthPacking
    const depthMeshBack = new THREE.Mesh(geometry, depthMatBack)
    backScene.add(depthMeshBack)

    // Shader Material & Mesh
    const shaderConfigs = {
        'stepSize': 0.02,
        'cellSize': 4,
        'lightTheta': Math.PI/4,
        'lightPhi': Math.PI/3,
        'color': [0.8,0.8,0.8]
    }
    const material = new THREE.ShaderMaterial({
        uniforms: {
            'uFrontTexture': { 'value': renderTargetFront.texture },
            'uBackTexture': { 'value': renderTargetBack.texture },
            'uCameraPos': { 'value': camera.position },
            'uCameraSize': { 'value': new THREE.Vector2(width/dpmm, height/dpmm)},
            'uCameraNear': { 'value': cameraNear },
            'uCameraFar': { 'value': cameraFar },
            'uCameraZoom': { 'value': camera.zoom },
            'uStepSize': { 'value': shaderConfigs.stepSize },
            'uCellSize': { 'value': shaderConfigs.cellSize },
            'uColor': { 'value': shaderConfigs.color },
            'uLightTheta': { 'value': shaderConfigs.lightTheta },
            'uLightPhi': { 'value': shaderConfigs.lightPhi },
            'uLightCol': { 'value': meshConfigs.lightColor }
        },
        vertexShader: vert,
        fragmentShader: frag
    })
    console.log(material.uniforms)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    // Light Object 
    // from https://github.com/mrdoob/three.js/blob/master/examples/webgl_lights_physical.html)
    const bulbGeometry = new THREE.SphereGeometry( 0.1, 16, 8 );
    const bulbLight = new THREE.PointLight( 0xffee88, 1, 100, 2 );

    const bulbMat = new THREE.MeshStandardMaterial( {
        emissive: 0xffffff,
        emissiveIntensity: 1,
        color: 0x000000
    } );
    console.log(bulbMat)
    bulbLight.add( new THREE.Mesh( bulbGeometry, bulbMat ) );
    bulbLight.castShadow = true;
    scene.add( bulbLight );

    // Adjust Light Position
    let lightPos = lightPosition(shaderConfigs.lightTheta)
    bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])

    // Controls Change Event Listener
    controls.addEventListener('change', () => {
        material.uniforms.uCameraPos.value = camera.position
        material.uniforms.uCameraZoom.value = camera.zoom
        animate()
    })

    // Window Resize Event Listener
    window.addEventListener(
        'resize',
        () => {
            width = window.innerWidth
            height = window.innerHeight
            camera.aspect = width/height
            camera.updateProjectionMatrix()
            material.uniforms.uCameraSize.value = new THREE.Vector2(width/dpmm, height/dpmm)
            renderer.setSize(width, height)
            render()
        },
        false
    )

    // FPS Stats
    stats = Stats()
    document.body.appendChild(stats.dom)

    // UI
    const gui = new GUI()
    const sceneFolder = gui.addFolder('Scene Configs')
    sceneFolder.add(meshConfigs, 'geometry', Object.keys(geometries)).onChange( value => {
        mesh.geometry = geometries[value]
        depthMeshBack.geometry = geometries[value]
        depthMeshFront.geometry = geometries[value]
        animate()
    })
    sceneFolder.addColor({lightColor:meshConfigs.lightColor}, 'lightColor').onChange( value => {
        material.uniforms.uLightCol.value = value
        bulbMat.emissive = new THREE.Color(value[0], value[1], value[2])
        console.log(bulbMat)
        animate()
    })
    sceneFolder.add(shaderConfigs, 'lightTheta', 0, Math.PI*2).onChange( value => {
        material.uniforms.uLightTheta.value = value
        lightPos = lightPosition(shaderConfigs.lightPhi, value)
        bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])
        animate()
    })
    // sceneFolder.add(shaderConfigs, 'lightPhi', 0, Math.PI).onChange( value => {
    //     material.uniforms.uLightPhi.value = value
    //     lightPos = lightPosition(value, shaderConfigs.lightTheta)
    //     bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])
    //     animate()
    // })
    const shaderFolder = gui.addFolder('Shader Configs')
    shaderFolder.add(shaderConfigs, 'stepSize', 0.001, 0.1).onChange( value => { 
        material.uniforms.uStepSize.value = value 
        animate()
    })
    shaderFolder.add(shaderConfigs, 'cellSize', 0.5, 10).onChange( value => { 
        material.uniforms.uCellSize.value = value 
        animate()
    })
    shaderFolder.addColor({color:shaderConfigs.color}, 'color').onChange( value => {
        material.uniforms.uColor.value = value
        animate()
    })


}

// Cycle Animation
function animate() {
    // requestAnimationFrame(animate)
    // controls.update()
    render()
    render()
    stats.update()
}

// Render one frame
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

// Start!
Init()
animate()
// setTimeout(render, 100)
