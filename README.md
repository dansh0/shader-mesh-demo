# Combined Mesh & SDF Shader Demo

### Overview
Raymarching and SDFs are a great way to make highly efficient shapes and fills, but integrating them into a mesh scene is very difficult, since meshes don't convert to SDFs nicely or vice-versa.

This is a cheap way of combining them, by sampling the front (entrance) depth and back (exit) depth of the meshes in the scene, and then applying a triply-periodic infill or volumetric environment to these zones on a pixel-to-pixel basis using the fragment shader.

Here I use an example of TPMS structures (gyroids, schwarz-p) and beam structures (octet) to show how this can create good looking infills for fairly cheap. The marcher is fixed-step to allow for future plans of volumetric properties, but this approach works fine with a standard raymarcher as well.

### Limitations

The main limitation I am facing is the ability to enter and exit the mesh multiple times. In the geometries torus, torusKnot, and teapot, you can see the shader "give-up" after it exits the first layer of triangles. Any ideas on how to fix this would be appreciated. All it would need is a list of all intersecting triangles with the fragment and their depths, like a raycast would. Even adding a second hardcoded depth checking pass or a third would greatly benefit many geometry cases. 

### Examples
![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094746.png)

![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094843.png)

![](https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20095000.png)
