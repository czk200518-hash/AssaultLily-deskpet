/*!
 * skel36-binary.js — Spine 3.6 二进制骨骼解析器(JS 移植版)
 *
 * 依据官方 spine-runtimes 3.6.53 的 SkeletonBinary.java 逐行移植,
 * 直接构建 spine-ts 3.6 运行时的 SkeletonData 对象。
 * 用法: 先加载 spine-core.js(3.6), 再加载本文件, 然后:
 *   var binary = new spine.SkeletonBinary36(attachmentLoader);
 *   var skeletonData = binary.readSkeletonData(uint8Array);
 */
(function (spine) {
  'use strict';

  var BONE_ROTATE = 0, BONE_TRANSLATE = 1, BONE_SCALE = 2, BONE_SHEAR = 3;
  var SLOT_ATTACHMENT = 0, SLOT_COLOR = 1, SLOT_TWO_COLOR = 2;
  var PATH_POSITION = 0, PATH_SPACING = 1, PATH_MIX = 2;
  var CURVE_LINEAR = 0, CURVE_STEPPED = 1, CURVE_BEZIER = 2;

  // 大端读取器(与官方 gdx DataInput / C# BinaryInput 一致)
  function BinaryInput(data) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.position = 0;
    this.strings = [];
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }
  BinaryInput.prototype.readByte = function () {
    return this.bytes[this.position++];
  };
  // 有符号字节(bendDirection 等)
  BinaryInput.prototype.readSByte = function () {
    var b = this.bytes[this.position++];
    return b > 127 ? b - 256 : b;
  };
  BinaryInput.prototype.readBoolean = function () {
    return this.bytes[this.position++] !== 0;
  };
  BinaryInput.prototype.readShort = function () {
    var v = this.view.getInt16(this.position, false);
    this.position += 2;
    return v;
  };
  // 1-5 字节 varint(optimizePositive=false 时 zigzag 解码)
  BinaryInput.prototype.readInt = function (optimizePositive) {
    var b = this.readByte();
    var result = b & 0x7f;
    if ((b & 0x80) !== 0) {
      b = this.readByte();
      result |= (b & 0x7f) << 7;
      if ((b & 0x80) !== 0) {
        b = this.readByte();
        result |= (b & 0x7f) << 14;
        if ((b & 0x80) !== 0) {
          b = this.readByte();
          result |= (b & 0x7f) << 21;
          if ((b & 0x80) !== 0) result |= (this.readByte() & 0x7f) << 28;
        }
      }
    }
    return optimizePositive ? result : ((result >>> 1) ^ -(result & 1));
  };
  // 4 字节大端有符号整数(颜色等)
  BinaryInput.prototype.readInt32 = function () {
    var v = this.view.getInt32(this.position, false);
    this.position += 4;
    return v;
  };
  BinaryInput.prototype.readFloat = function () {
    var v = this.view.getFloat32(this.position, false); // 大端
    this.position += 4;
    return v;
  };
  BinaryInput.prototype.readString = function () {
    var byteCount = this.readInt(true);
    if (byteCount === 0) return null;
    if (byteCount === 1) return '';
    byteCount--;
    var s = '';
    var bytes = this.bytes;
    var i = this.position, end = i + byteCount;
    while (i < end) {
      var b = bytes[i++];
      if (b < 0x80) {
        s += String.fromCharCode(b);
      } else if ((b >> 5) === 0x6) {
        s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if ((b >> 4) === 0xe) {
        s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        var c = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        c -= 0x10000;
        s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      }
    }
    this.position = end;
    return s;
  };

  function rgba8888ToColor(color, value) {
    color.r = ((value >>> 24) & 0xff) / 255;
    color.g = ((value >>> 16) & 0xff) / 255;
    color.b = ((value >>> 8) & 0xff) / 255;
    color.a = (value & 0xff) / 255;
  }
  function rgb888ToColor(color, value) {
    color.r = ((value >>> 16) & 0xff) / 255;
    color.g = ((value >>> 8) & 0xff) / 255;
    color.b = (value & 0xff) / 255;
  }
  function zeroArray(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  function SkeletonBinary36(attachmentLoader) {
    if (attachmentLoader == null) throw new Error('attachmentLoader cannot be null.');
    this.attachmentLoader = attachmentLoader;
    this.scale = 1;
    this.linkedMeshes = [];
  }
  SkeletonBinary36.prototype.setScale = function (scale) {
    this.scale = scale;
  };

  SkeletonBinary36.prototype.readSkeletonData = function (binary) {
    var scale = this.scale;
    var skeletonData = new spine.SkeletonData();
    skeletonData.name = 'skeleton';

    var input = new BinaryInput(binary);
    skeletonData.hash = input.readString();
    if (!skeletonData.hash) skeletonData.hash = null;
    skeletonData.version = input.readString();
    if (!skeletonData.version) skeletonData.version = null;
    skeletonData.width = input.readFloat();
    skeletonData.height = input.readFloat();

    var nonessential = input.readBoolean();

    if (nonessential) {
      skeletonData.fps = input.readFloat();
      skeletonData.imagesPath = input.readString();
      if (!skeletonData.imagesPath) skeletonData.imagesPath = null;
    }

    // 骨骼
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var name = input.readString();
      var parent = i === 0 ? null : skeletonData.bones[input.readInt(true)];
      var data = new spine.BoneData(i, name, parent);
      data.rotation = input.readFloat();
      data.x = input.readFloat() * scale;
      data.y = input.readFloat() * scale;
      data.scaleX = input.readFloat();
      data.scaleY = input.readFloat();
      data.shearX = input.readFloat();
      data.shearY = input.readFloat();
      data.length = input.readFloat() * scale;
      data.transformMode = input.readInt(true); // TransformMode 枚举索引
      if (nonessential) {
        if (!data.color) data.color = new spine.Color();
        rgba8888ToColor(data.color, input.readInt32());
      }
      skeletonData.bones.push(data);
    }

    // 槽位
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var slotName = input.readString();
      var boneData = skeletonData.bones[input.readInt(true)];
      var data = new spine.SlotData(i, slotName, boneData);
      rgba8888ToColor(data.color, input.readInt32());
      var darkColor = input.readInt32();
      if (darkColor !== -1) {
        if (!data.darkColor) data.darkColor = new spine.Color();
        rgb888ToColor(data.darkColor, darkColor);
      }
      data.attachmentName = input.readString();
      data.blendMode = input.readInt(true); // BlendMode 枚举索引
      skeletonData.slots.push(data);
    }

    // IK 约束
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var data = new spine.IkConstraintData(input.readString());
      data.order = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.bones[input.readInt(true)];
      data.mix = input.readFloat();
      data.bendDirection = input.readSByte(); // 有符号字节(正负决定膝盖弯曲方向)
      skeletonData.ikConstraints.push(data);
    }

    // 变换约束
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var data = new spine.TransformConstraintData(input.readString());
      data.order = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.bones[input.readInt(true)];
      data.local = input.readBoolean();
      data.relative = input.readBoolean();
      data.offsetRotation = input.readFloat();
      data.offsetX = input.readFloat() * scale;
      data.offsetY = input.readFloat() * scale;
      data.offsetScaleX = input.readFloat();
      data.offsetScaleY = input.readFloat();
      data.offsetShearY = input.readFloat();
      data.rotateMix = input.readFloat();
      data.translateMix = input.readFloat();
      data.scaleMix = input.readFloat();
      data.shearMix = input.readFloat();
      skeletonData.transformConstraints.push(data);
    }

    // 路径约束
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var data = new spine.PathConstraintData(input.readString());
      data.order = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.slots[input.readInt(true)];
      data.positionMode = input.readInt(true);
      data.spacingMode = input.readInt(true);
      data.rotateMode = input.readInt(true);
      data.offsetRotation = input.readFloat();
      data.position = input.readFloat();
      if (data.positionMode === 0 /* fixed */) data.position *= scale;
      data.spacing = input.readFloat();
      if (data.spacingMode === 0 /* length */ || data.spacingMode === 1 /* fixed */) data.spacing *= scale;
      data.rotateMix = input.readFloat();
      data.translateMix = input.readFloat();
      skeletonData.pathConstraints.push(data);
    }

    // 默认皮肤
    var defaultSkin = this.readSkin(input, skeletonData, 'default', nonessential);
    if (defaultSkin != null) {
      skeletonData.defaultSkin = defaultSkin;
      skeletonData.skins.push(defaultSkin);
    }

    // 其它皮肤
    for (var i = 0, n = input.readInt(true); i < n; i++)
      skeletonData.skins.push(this.readSkin(input, skeletonData, input.readString(), nonessential));

    // 关联网格(linked mesh)
    for (var i = 0, n = this.linkedMeshes.length; i < n; i++) {
      var linkedMesh = this.linkedMeshes[i];
      var skin = linkedMesh.skin == null ? skeletonData.defaultSkin : skeletonData.findSkin(linkedMesh.skin);
      if (skin == null) throw new Error('Skin not found: ' + linkedMesh.skin);
      var parentAttachment = skin.getAttachment(linkedMesh.slotIndex, linkedMesh.parent);
      if (parentAttachment == null) throw new Error('Parent mesh not found: ' + linkedMesh.parent);
      linkedMesh.mesh.setParentMesh(parentAttachment);
      linkedMesh.mesh.updateUVs();
    }
    this.linkedMeshes.length = 0;

    // 事件
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var data = new spine.EventData(input.readString());
      data.intValue = input.readInt(false);
      data.floatValue = input.readFloat();
      data.stringValue = input.readString();
      skeletonData.events.push(data);
    }

    // 动画
    for (var i = 0, n = input.readInt(true); i < n; i++)
      this.readAnimation(input, input.readString(), skeletonData);

    return skeletonData;
  };

  /** @return May be null. */
  SkeletonBinary36.prototype.readSkin = function (input, skeletonData, skinName, nonessential) {
    var slotCount = input.readInt(true);
    if (slotCount === 0) return null;
    var skin = new spine.Skin(skinName);
    for (var i = 0; i < slotCount; i++) {
      var slotIndex = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var name = input.readString();
        var attachment = this.readAttachment(input, skeletonData, skin, slotIndex, name, nonessential);
        if (attachment != null) skin.addAttachment(slotIndex, name, attachment);
      }
    }
    return skin;
  };

  SkeletonBinary36.prototype.readAttachment = function (input, skeletonData, skin, slotIndex, attachmentName, nonessential) {
    var scale = this.scale;

    var name = input.readString();
    if (name == null) name = attachmentName;

    var type = input.readByte();
    switch (type) {
    case 0: { // region
      var path = input.readString();
      var rotation = input.readFloat();
      var x = input.readFloat();
      var y = input.readFloat();
      var scaleX = input.readFloat();
      var scaleY = input.readFloat();
      var width = input.readFloat();
      var height = input.readFloat();
      var color = input.readInt32();

      if (path == null) path = name;
      var region = this.attachmentLoader.newRegionAttachment(skin, name, path);
      if (region == null) return null;
      region.path = path;
      region.x = x * scale;
      region.y = y * scale;
      region.scaleX = scaleX;
      region.scaleY = scaleY;
      region.rotation = rotation;
      region.width = width * scale;
      region.height = height * scale;
      rgba8888ToColor(region.color, color);
      region.updateOffset();
      return region;
    }
    case 1: { // boundingbox
      var vertexCount = input.readInt(true);
      var vertices = this.readVertices(input, vertexCount);
      var color = nonessential ? input.readInt32() : 0;

      var box = this.attachmentLoader.newBoundingBoxAttachment(skin, name);
      if (box == null) return null;
      box.worldVerticesLength = vertexCount << 1;
      box.vertices = vertices.vertices;
      box.bones = vertices.bones;
      if (nonessential) rgba8888ToColor(box.color, color);
      return box;
    }
    case 2: { // mesh
      var path = input.readString();
      var color = input.readInt32();
      var vertexCount = input.readInt(true);
      var uvs = this.readFloatArray(input, vertexCount << 1, 1);
      var triangles = this.readShortArray(input);
      var vertices = this.readVertices(input, vertexCount);
      var hullLength = input.readInt(true);
      var edges = null;
      var width = 0, height = 0;
      if (nonessential) {
        edges = this.readShortArray(input);
        width = input.readFloat();
        height = input.readFloat();
      }

      if (path == null) path = name;
      var mesh = this.attachmentLoader.newMeshAttachment(skin, name, path);
      if (mesh == null) return null;
      mesh.path = path;
      rgba8888ToColor(mesh.color, color);
      mesh.bones = vertices.bones;
      mesh.vertices = vertices.vertices;
      mesh.worldVerticesLength = vertexCount << 1;
      mesh.triangles = triangles;
      mesh.regionUVs = uvs;
      mesh.updateUVs();
      mesh.hullLength = hullLength << 1;
      if (nonessential) {
        mesh.edges = edges;
        mesh.width = width * scale;
        mesh.height = height * scale;
      }
      return mesh;
    }
    case 3: { // linkedmesh
      var path = input.readString();
      var color = input.readInt32();
      var skinName = input.readString();
      var parent = input.readString();
      var inheritDeform = input.readBoolean();
      var width = 0, height = 0;
      if (nonessential) {
        width = input.readFloat();
        height = input.readFloat();
      }

      if (path == null) path = name;
      var mesh = this.attachmentLoader.newMeshAttachment(skin, name, path);
      if (mesh == null) return null;
      mesh.path = path;
      rgba8888ToColor(mesh.color, color);
      mesh.inheritDeform = inheritDeform;
      if (nonessential) {
        mesh.width = width * scale;
        mesh.height = height * scale;
      }
      this.linkedMeshes.push({ mesh: mesh, skin: skinName, slotIndex: slotIndex, parent: parent });
      return mesh;
    }
    case 4: { // path
      var closed = input.readBoolean();
      var constantSpeed = input.readBoolean();
      var vertexCount = input.readInt(true);
      var vertices = this.readVertices(input, vertexCount);
      var lengths = new Array(vertexCount / 3);
      for (var i = 0, n = lengths.length; i < n; i++)
        lengths[i] = input.readFloat() * scale;
      var color = nonessential ? input.readInt32() : 0;

      var pathAttachment = this.attachmentLoader.newPathAttachment(skin, name);
      if (pathAttachment == null) return null;
      pathAttachment.closed = closed;
      pathAttachment.constantSpeed = constantSpeed;
      pathAttachment.worldVerticesLength = vertexCount << 1;
      pathAttachment.vertices = vertices.vertices;
      pathAttachment.bones = vertices.bones;
      pathAttachment.lengths = lengths;
      if (nonessential) rgba8888ToColor(pathAttachment.color, color);
      return pathAttachment;
    }
    case 5: { // point
      var rotation = input.readFloat();
      var x = input.readFloat();
      var y = input.readFloat();
      var color = nonessential ? input.readInt32() : 0;

      var point = this.attachmentLoader.newPointAttachment(skin, name);
      if (point == null) return null;
      point.x = x * scale;
      point.y = y * scale;
      point.rotation = rotation;
      if (nonessential) rgba8888ToColor(point.color, color);
      return point;
    }
    case 6: { // clipping
      var endSlotIndex = input.readInt(true);
      var vertexCount = input.readInt(true);
      var vertices = this.readVertices(input, vertexCount);
      var color = nonessential ? input.readInt32() : 0;

      var clip = this.attachmentLoader.newClippingAttachment(skin, name);
      if (clip == null) return null;
      clip.endSlot = skeletonData.slots[endSlotIndex];
      clip.worldVerticesLength = vertexCount << 1;
      clip.vertices = vertices.vertices;
      clip.bones = vertices.bones;
      if (nonessential) rgba8888ToColor(clip.color, color);
      return clip;
    }
    }
    return null;
  };

  SkeletonBinary36.prototype.readVertices = function (input, vertexCount) {
    var verticesLength = vertexCount << 1;
    var vertices = { bones: null, vertices: null };
    if (!input.readBoolean()) {
      vertices.vertices = this.readFloatArray(input, verticesLength, this.scale);
      return vertices;
    }
    var weights = [];
    var bonesArray = [];
    for (var i = 0; i < vertexCount; i++) {
      var boneCount = input.readInt(true);
      bonesArray.push(boneCount);
      for (var ii = 0; ii < boneCount; ii++) {
        bonesArray.push(input.readInt(true));
        weights.push(input.readFloat() * this.scale);
        weights.push(input.readFloat() * this.scale);
        weights.push(input.readFloat());
      }
    }
    vertices.vertices = weights;
    vertices.bones = bonesArray;
    return vertices;
  };

  SkeletonBinary36.prototype.readFloatArray = function (input, n, scale) {
    var array = new Array(n);
    if (scale === 1) {
      for (var i = 0; i < n; i++)
        array[i] = input.readFloat();
    } else {
      for (var i = 0; i < n; i++)
        array[i] = input.readFloat() * scale;
    }
    return array;
  };

  SkeletonBinary36.prototype.readShortArray = function (input) {
    var n = input.readInt(true);
    var array = new Array(n);
    for (var i = 0; i < n; i++)
      array[i] = input.readShort();
    return array;
  };

  SkeletonBinary36.prototype.readAnimation = function (input, name, skeletonData) {
    var timelines = [];
    var scale = this.scale;
    var duration = 0;

    // 槽位时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var slotIndex = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var timelineType = input.readByte();
        var frameCount = input.readInt(true);
        switch (timelineType) {
        case SLOT_ATTACHMENT: {
          var timeline = new spine.AttachmentTimeline(frameCount);
          timeline.slotIndex = slotIndex;
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++)
            timeline.setFrame(frameIndex, input.readFloat(), input.readString());
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[frameCount - 1]);
          break;
        }
        case SLOT_COLOR: {
          var timeline = new spine.ColorTimeline(frameCount);
          timeline.slotIndex = slotIndex;
          var tempColor1 = new spine.Color();
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            var time = input.readFloat();
            rgba8888ToColor(tempColor1, input.readInt32());
            timeline.setFrame(frameIndex, time, tempColor1.r, tempColor1.g, tempColor1.b, tempColor1.a);
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.ColorTimeline.ENTRIES]);
          break;
        }
        case SLOT_TWO_COLOR: {
          var timeline = new spine.TwoColorTimeline(frameCount);
          timeline.slotIndex = slotIndex;
          var tempColor1 = new spine.Color(), tempColor2 = new spine.Color();
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            var time = input.readFloat();
            rgba8888ToColor(tempColor1, input.readInt32());
            rgb888ToColor(tempColor2, input.readInt32());
            timeline.setFrame(frameIndex, time, tempColor1.r, tempColor1.g, tempColor1.b, tempColor1.a,
              tempColor2.r, tempColor2.g, tempColor2.b);
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.TwoColorTimeline.ENTRIES]);
          break;
        }
        }
      }
    }

    // 骨骼时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var boneIndex = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var timelineType = input.readByte();
        var frameCount = input.readInt(true);
        switch (timelineType) {
        case BONE_ROTATE: {
          var timeline = new spine.RotateTimeline(frameCount);
          timeline.boneIndex = boneIndex;
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            timeline.setFrame(frameIndex, input.readFloat(), input.readFloat());
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.RotateTimeline.ENTRIES]);
          break;
        }
        case BONE_TRANSLATE:
        case BONE_SCALE:
        case BONE_SHEAR: {
          var timeline;
          var timelineScale = 1;
          if (timelineType === BONE_SCALE)
            timeline = new spine.ScaleTimeline(frameCount);
          else if (timelineType === BONE_SHEAR)
            timeline = new spine.ShearTimeline(frameCount);
          else {
            timeline = new spine.TranslateTimeline(frameCount);
            timelineScale = scale;
          }
          timeline.boneIndex = boneIndex;
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            timeline.setFrame(frameIndex, input.readFloat(), input.readFloat() * timelineScale,
              input.readFloat() * timelineScale);
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.TranslateTimeline.ENTRIES]);
          break;
        }
        }
      }
    }

    // IK 约束时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var index = input.readInt(true);
      var frameCount = input.readInt(true);
      var timeline = new spine.IkConstraintTimeline(frameCount);
      timeline.ikConstraintIndex = index;
      for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readSByte());
        if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.IkConstraintTimeline.ENTRIES]);
    }

    // 变换约束时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var index = input.readInt(true);
      var frameCount = input.readInt(true);
      var timeline = new spine.TransformConstraintTimeline(frameCount);
      timeline.transformConstraintIndex = index;
      for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat(),
          input.readFloat());
        if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.TransformConstraintTimeline.ENTRIES]);
    }

    // 路径约束时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var index = input.readInt(true);
      var data = skeletonData.pathConstraints[index];
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var timelineType = input.readByte();
        var frameCount = input.readInt(true);
        switch (timelineType) {
        case PATH_POSITION:
        case PATH_SPACING: {
          var timeline;
          var timelineScale = 1;
          if (timelineType === PATH_SPACING) {
            timeline = new spine.PathConstraintSpacingTimeline(frameCount);
            if (data.spacingMode === 0 /* length */ || data.spacingMode === 1 /* fixed */) timelineScale = scale;
          } else {
            timeline = new spine.PathConstraintPositionTimeline(frameCount);
            if (data.positionMode === 0 /* fixed */) timelineScale = scale;
          }
          timeline.pathConstraintIndex = index;
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            timeline.setFrame(frameIndex, input.readFloat(), input.readFloat() * timelineScale);
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.PathConstraintPositionTimeline.ENTRIES]);
          break;
        }
        case PATH_MIX: {
          var timeline = new spine.PathConstraintMixTimeline(frameCount);
          timeline.pathConstraintIndex = index;
          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readFloat());
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[(frameCount - 1) * spine.PathConstraintMixTimeline.ENTRIES]);
          break;
        }
        }
      }
    }

    // 变形时间轴
    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var skin = skeletonData.skins[input.readInt(true)];
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var slotIndex = input.readInt(true);
        for (var iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
          var attachment = skin.getAttachment(slotIndex, input.readString());
          var weighted = attachment.bones != null;
          var vertices = attachment.vertices;
          var deformLength = weighted ? (vertices.length / 3) * 2 : vertices.length;

          var frameCount = input.readInt(true);
          var timeline = new spine.DeformTimeline(frameCount);
          timeline.slotIndex = slotIndex;
          timeline.attachment = attachment;

          for (var frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            var time = input.readFloat();
            var deform;
            var end = input.readInt(true);
            if (end === 0) {
              // Java: new float[n] 为零填充数组,JS 必须显式填 0
              deform = weighted ? zeroArray(deformLength) : vertices;
            } else {
              deform = zeroArray(deformLength);
              var start = input.readInt(true);
              end += start;
              if (scale === 1) {
                for (var v = start; v < end; v++)
                  deform[v] = input.readFloat();
              } else {
                for (var v = start; v < end; v++)
                  deform[v] = input.readFloat() * scale;
              }
              if (!weighted) {
                for (var v = 0, vn = deform.length; v < vn; v++)
                  deform[v] += vertices[v];
              }
            }

            timeline.setFrame(frameIndex, time, deform);
            if (frameIndex < frameCount - 1) this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[frameCount - 1]);
        }
      }
    }

    // 绘制顺序时间轴
    var drawOrderCount = input.readInt(true);
    if (drawOrderCount > 0) {
      var timeline = new spine.DrawOrderTimeline(drawOrderCount);
      var slotCount = skeletonData.slots.length;
      for (var i = 0; i < drawOrderCount; i++) {
        var time = input.readFloat();
        var offsetCount = input.readInt(true);
        var drawOrder = new Array(slotCount);
        for (var ii = slotCount - 1; ii >= 0; ii--)
          drawOrder[ii] = -1;
        var unchanged = new Array(slotCount - offsetCount);
        var originalIndex = 0, unchangedIndex = 0;
        for (var ii = 0; ii < offsetCount; ii++) {
          var slotIndex = input.readInt(true);
          while (originalIndex !== slotIndex)
            unchanged[unchangedIndex++] = originalIndex++;
          drawOrder[originalIndex + input.readInt(true)] = originalIndex++;
        }
        while (originalIndex < slotCount)
          unchanged[unchangedIndex++] = originalIndex++;
        for (var ii = slotCount - 1; ii >= 0; ii--)
          if (drawOrder[ii] === -1) drawOrder[ii] = unchanged[--unchangedIndex];
        timeline.setFrame(i, time, drawOrder);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[drawOrderCount - 1]);
    }

    // 事件时间轴
    var eventCount = input.readInt(true);
    if (eventCount > 0) {
      var timeline = new spine.EventTimeline(eventCount);
      for (var i = 0; i < eventCount; i++) {
        var time = input.readFloat();
        var eventData = skeletonData.events[input.readInt(true)];
        var event = new spine.Event(time, eventData);
        event.intValue = input.readInt(false);
        event.floatValue = input.readFloat();
        event.stringValue = input.readBoolean() ? input.readString() : eventData.stringValue;
        timeline.setFrame(i, event);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[eventCount - 1]);
    }

    skeletonData.animations.push(new spine.Animation(name, timelines, duration));
  };

  SkeletonBinary36.prototype.readCurve = function (input, frameIndex, timeline) {
    switch (input.readByte()) {
    case CURVE_STEPPED:
      timeline.setStepped(frameIndex);
      break;
    case CURVE_BEZIER:
      timeline.setCurve(frameIndex, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat());
      break;
    }
  };

  spine.SkeletonBinary36 = SkeletonBinary36;
})(typeof spine !== 'undefined' ? spine : (typeof globalThis !== 'undefined' ? globalThis.spine = {} : {}));
