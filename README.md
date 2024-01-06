# Combined Mesh & SDF Shader Demo

### Overview
Raymarching and SDFs are a great way to make highly efficient shapes and fills, but integrating them into a mesh scene is very difficult, since meshes don't convert to SDFs nicely or vice-versa.

This is a cheap way of combining them, by sampling the front (entrance) depth and back (exit) depth of the meshes in the scene, and then applying a triply-periodic infill or volumetric environment to these zones on a pixel-to-pixel basis using the fragment shader.

Here I use an example of TPMS structures (gyroids, schwarz-p) and beam structures (octet) to show how this can create good looking infills for fairly cheap. The marcher is fixed-step to allow for future plans of volumetric properties, but this approach works fine with a standard raymarcher as well.

### To Run

```
npm install
npm start
```


### Examples
![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094746.png)

![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094843.png)

![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20095000.png)
