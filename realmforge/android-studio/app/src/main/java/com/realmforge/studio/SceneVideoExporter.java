package com.realmforge.studio;
import android.media.*;
import android.opengl.*;
import android.view.Surface;
import java.io.File;
import java.nio.*;
public final class SceneVideoExporter {
 private static final String VS="#version 300 es\nlayout(location=0) in vec3 p;uniform float angle;void main(){float c=cos(angle),s=sin(angle);vec3 q=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z-3.0);gl_Position=vec4(q.x*1.4,q.y*1.4,q.z*0.1+1.5,-q.z);}";
 private static final String FS="#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(0.2,0.7,0.95,1.0);}";
 private static int compile(int type,String src){int s=GLES30.glCreateShader(type);GLES30.glShaderSource(s,src);GLES30.glCompileShader(s);int[] ok=new int[1];GLES30.glGetShaderiv(s,GLES30.GL_COMPILE_STATUS,ok,0);if(ok[0]==0)throw new IllegalStateException(GLES30.glGetShaderInfoLog(s));return s;}
 private static int program(){int v=compile(GLES30.GL_VERTEX_SHADER,VS),f=compile(GLES30.GL_FRAGMENT_SHADER,FS);int p=GLES30.glCreateProgram();GLES30.glAttachShader(p,v);GLES30.glAttachShader(p,f);GLES30.glLinkProgram(p);int[] ok=new int[1];GLES30.glGetProgramiv(p,GLES30.GL_LINK_STATUS,ok,0);GLES30.glDeleteShader(v);GLES30.glDeleteShader(f);if(ok[0]==0)throw new IllegalStateException(GLES30.glGetProgramInfoLog(p));return p;}
 private static final float[] CUBE={
 -1,-1,1, 1,-1,1, 1,1,1, -1,-1,1, 1,1,1, -1,1,1,
 1,-1,-1,-1,-1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,1,-1,
 -1,-1,-1,-1,-1,1,-1,1,1,-1,-1,-1,-1,1,1,-1,1,-1,
 1,-1,1,1,-1,-1,1,1,-1,1,-1,1,1,1,-1,1,1,1,
 -1,1,1,1,1,1,1,1,-1,-1,1,1,1,1,-1,-1,1,-1,
 -1,-1,-1,1,-1,-1,1,-1,1,-1,-1,-1,1,-1,1,-1,-1,1};
 public void export(File output,int width,int height,int fps,int seconds)throws Exception{
 if(width<16||height<16||width%2!=0||height%2!=0||fps<=0||seconds<=0)throw new IllegalArgumentException("Invalid dimensions or timing");
 MediaCodec codec=null;MediaMuxer mux=null;Surface surface=null;EGLDisplay display=EGL14.EGL_NO_DISPLAY;EGLContext context=EGL14.EGL_NO_CONTEXT;EGLSurface eglSurface=EGL14.EGL_NO_SURFACE;boolean started=false;int track=-1;
 try{
 MediaFormat fmt=MediaFormat.createVideoFormat("video/avc",width,height);fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);fmt.setInteger(MediaFormat.KEY_BIT_RATE,4_000_000);fmt.setInteger(MediaFormat.KEY_FRAME_RATE,fps);fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
 codec=MediaCodec.createEncoderByType("video/avc");codec.configure(fmt,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);surface=codec.createInputSurface();codec.start();
 mux=new MediaMuxer(output.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
 display=EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);int[] version=new int[2];if(display==EGL14.EGL_NO_DISPLAY||!EGL14.eglInitialize(display,version,0,version,1))throw new IllegalStateException("EGL display unavailable");
 int[] attrib={EGL14.EGL_RENDERABLE_TYPE,EGLExt.EGL_OPENGL_ES3_BIT_KHR,EGL14.EGL_RED_SIZE,8,EGL14.EGL_GREEN_SIZE,8,EGL14.EGL_BLUE_SIZE,8,0x3142,1,EGL14.EGL_NONE};EGLConfig[] cfg=new EGLConfig[1];int[] count=new int[1];if(!EGL14.eglChooseConfig(display,attrib,0,cfg,0,1,count,0)||count[0]==0)throw new IllegalStateException("ES3 config unavailable");
 context=EGL14.eglCreateContext(display,cfg[0],EGL14.EGL_NO_CONTEXT,new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION,3,EGL14.EGL_NONE},0);
 eglSurface=EGL14.eglCreateWindowSurface(display,cfg[0],surface,new int[]{EGL14.EGL_NONE},0);
 if(context==EGL14.EGL_NO_CONTEXT||eglSurface==EGL14.EGL_NO_SURFACE||!EGL14.eglMakeCurrent(display,eglSurface,eglSurface,context))throw new IllegalStateException("EGL surface/context failed");
 int p=program();FloatBuffer vertices=ByteBuffer.allocateDirect(CUBE.length*4).order(ByteOrder.nativeOrder()).asFloatBuffer();vertices.put(CUBE).position(0);
 int[] vao=new int[1],vbo=new int[1];GLES30.glGenVertexArrays(1,vao,0);GLES30.glGenBuffers(1,vbo,0);GLES30.glBindVertexArray(vao[0]);GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER,vbo[0]);GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER,CUBE.length*4,vertices,GLES30.GL_STATIC_DRAW);GLES30.glEnableVertexAttribArray(0);GLES30.glVertexAttribPointer(0,3,GLES30.GL_FLOAT,false,12,0);GLES30.glEnable(GLES30.GL_DEPTH_TEST);GLES30.glViewport(0,0,width,height);
 MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();boolean eos=false;int frame=0;long deadline=System.nanoTime()+Math.max(120_000_000_000L,seconds*3_000_000_000L);
 while(!eos){if(System.nanoTime()>deadline)throw new IllegalStateException("Encoder timed out");
 if(frame<fps*seconds){GLES30.glClearColor(.025f,.035f,.09f,1);GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT|GLES30.GL_DEPTH_BUFFER_BIT);GLES30.glUseProgram(p);GLES30.glUniform1f(GLES30.glGetUniformLocation(p,"angle"),frame*6.2831853f/(fps*seconds));GLES30.glDrawArrays(GLES30.GL_TRIANGLES,0,CUBE.length/3);EGLExt.eglPresentationTimeANDROID(display,eglSurface,frame*1_000_000_000L/fps);if(!EGL14.eglSwapBuffers(display,eglSurface))throw new IllegalStateException("eglSwapBuffers failed");frame++;if(frame==fps*seconds)codec.signalEndOfInputStream();}
 int idx=codec.dequeueOutputBuffer(info,10000);if(idx==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){if(started)throw new IllegalStateException("Output format changed twice");track=mux.addTrack(codec.getOutputFormat());mux.start();started=true;}
 else if(idx>=0){ByteBuffer data=codec.getOutputBuffer(idx);if(data==null)throw new IllegalStateException("Null encoded buffer");if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0&&info.size>0){if(!started)throw new IllegalStateException("Muxer not started");data.position(info.offset);data.limit(info.offset+info.size);mux.writeSampleData(track,data,info);}eos=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;codec.releaseOutputBuffer(idx,false);}
 }
 GLES30.glDeleteBuffers(1,vbo,0);GLES30.glDeleteVertexArrays(1,vao,0);GLES30.glDeleteProgram(p);
 }finally{
 if(display!=EGL14.EGL_NO_DISPLAY){EGL14.eglMakeCurrent(display,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_CONTEXT);if(eglSurface!=EGL14.EGL_NO_SURFACE)EGL14.eglDestroySurface(display,eglSurface);if(context!=EGL14.EGL_NO_CONTEXT)EGL14.eglDestroyContext(display,context);EGL14.eglTerminate(display);}
 if(surface!=null)surface.release();if(codec!=null){try{codec.stop();}catch(Exception ignored){}codec.release();}if(mux!=null){if(started)try{mux.stop();}catch(Exception ignored){}mux.release();}
 }
 }
}