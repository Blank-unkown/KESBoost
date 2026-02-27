package com.examtrack.app;

import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import com.examtrack.app.NativeScanPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativeScanPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onStart() {
    super.onStart();
    bridge.getWebView().setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        request.grant(request.getResources()); // Automatically grant camera
      }
    });
  }
}
