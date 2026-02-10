+++ b/test.js
@@ -1,3 +1,6 @@t
function helloWorld() {
  static callCount = 0;
   console.log('Hello world!');
+  
+  return ++callCount;
}
function helloWorld() {
  console.log('Hello world!');
}