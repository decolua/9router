package com.realmforge.studio;
import android.app.Activity;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.content.ActivityNotFoundException;
import androidx.core.content.FileProvider;
import android.content.Intent;
import android.os.Bundle;
import android.widget.*;
import org.json.*;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
public final class MainActivity extends Activity {
 private TextView status, projectInfo; private Button export, play, share; private File lastVideo; private int duration=5; private String projectTitle="RealmForge";
 @Override public void onCreate(Bundle state){super.onCreate(state);
 LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(24,24,24,24);
 TextView title=new TextView(this);title.setText("RealmForge • 3D Studio");title.setTextSize(24);root.addView(title);
 projectInfo=new TextView(this);projectInfo.setText("No imported BTU project. Default 5-second scene.");root.addView(projectInfo);
 Button importButton=new Button(this);importButton.setText("Import BTU Bridge JSON");root.addView(importButton);
 importButton.setOnClickListener(v->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.setType("application/json");i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,301);});
 status=new TextView(this);status.setText("OpenGL ES 3 → H.264 MP4 • procedural cube preview, not AI video");root.addView(status);
 export=new Button(this);export.setText("Render MP4");root.addView(export);
 play=new Button(this);play.setText("Play MP4");play.setEnabled(false);root.addView(play);
 share=new Button(this);share.setText("Share MP4");share.setEnabled(false);root.addView(share);
 VideoView viewer=new VideoView(this);root.addView(viewer,new LinearLayout.LayoutParams(-1,420));viewer.setMediaController(new MediaController(this));
 play.setOnClickListener(v->{if(lastVideo!=null){viewer.setVideoPath(lastVideo.getAbsolutePath());viewer.setOnPreparedListener(mp->viewer.start());}});
 share.setOnClickListener(v->{if(lastVideo==null)return;try{Uri uri=FileProvider.getUriForFile(this,getPackageName()+".fileprovider",lastVideo);Intent i=new Intent(Intent.ACTION_SEND);i.setType("video/mp4");i.putExtra(Intent.EXTRA_STREAM,uri);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"Share RealmForge MP4"));}catch(Exception e){status.setText("Share failed: "+e.getMessage());}});
 setContentView(root);
 acceptIntent(getIntent());
 export.setOnClickListener(v->{export.setEnabled(false);status.setText("Rendering…");new Thread(()->{
 try {File out=new File(getExternalFilesDir(null),"realmforge-3d.mp4");new SceneVideoExporter().export(out,720,1280,30,duration);
 MediaMetadataRetriever probe=new MediaMetadataRetriever();String details;try{probe.setDataSource(out.getAbsolutePath());int w=Integer.parseInt(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));int h=Integer.parseInt(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));long ms=Long.parseLong(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));if(w!=720||h!=1280||ms<Math.max(500,(duration-1)*1000L)||out.length()<1024)throw new IllegalStateException("Invalid MP4: "+w+"x"+h+" "+ms+"ms");details=w+"x"+h+" • "+ms+"ms • "+out.length()+" bytes";}finally{probe.release();}runOnUiThread(()->{lastVideo=out;play.setEnabled(true);share.setEnabled(true);status.setText("MP4 verified: "+details+"\n"+out.getAbsolutePath());});}
 catch(Exception e){runOnUiThread(()->status.setText("Render failed: "+e.getMessage()));}
 finally{runOnUiThread(()->export.setEnabled(true));}
 }).start();});}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);acceptIntent(intent);}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==301&&result==RESULT_OK&&data!=null&&data.getData()!=null){try(InputStream in=getContentResolver().openInputStream(data.getData())){if(in==null)throw new IllegalArgumentException("No JSON data");byte[] bytes=new byte[131073];int n=0,k;while(n<bytes.length&&(k=in.read(bytes,n,bytes.length-n))>0)n+=k;if(n>=bytes.length)throw new IllegalArgumentException("Project exceeds 128KB");loadProject(new String(bytes,0,n,StandardCharsets.UTF_8));}catch(Exception e){status.setText("Import failed: "+e.getMessage());}}}
 private void acceptIntent(Intent intent){if(intent==null)return;try{if(Intent.ACTION_SEND.equals(intent.getAction())){String text=intent.getStringExtra(Intent.EXTRA_TEXT);if(text!=null)loadProject(text);}else if(Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getData()!=null){try(InputStream in=getContentResolver().openInputStream(intent.getData())){if(in!=null){byte[] bytes=new byte[131073];int n=0,k;while(n<bytes.length&&(k=in.read(bytes,n,bytes.length-n))>0)n+=k;if(n>=bytes.length)throw new IllegalArgumentException("Project too large");loadProject(new String(bytes,0,n,StandardCharsets.UTF_8));}}}}catch(Exception e){status.setText("Bridge error: "+e.getMessage());}}
 private void loadProject(String json)throws JSONException{JSONObject root=new JSONObject(json);if(!"BTU-Cinema-Bridge-v1".equals(root.optString("format")))throw new JSONException("Unsupported bridge format");JSONObject project=root.getJSONObject("project");JSONArray scenes=project.getJSONArray("scenes");if(scenes.length()==0)throw new JSONException("No scenes");int seconds=0;for(int i=0;i<scenes.length();i++){int d=scenes.getJSONObject(i).getInt("duration");if(d<1||d>120)throw new JSONException("Invalid scene duration");seconds+=d;}if(seconds>120)throw new JSONException("Maximum 120 seconds per export");duration=seconds;projectTitle=project.optString("title","Untitled");projectInfo.setText("Imported: "+projectTitle+" • "+scenes.length()+" scene(s) • "+duration+" seconds");status.setText("Project imported. MP4 currently renders procedural 3D cube, not prompt-based scenes.");}
}
