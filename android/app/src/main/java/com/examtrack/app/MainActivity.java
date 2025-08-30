
package com.examtrack.app;

import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
