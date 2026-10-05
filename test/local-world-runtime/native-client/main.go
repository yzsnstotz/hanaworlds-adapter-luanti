// Test-only native SRP/formspec client against the public Luanti protocol.
// Credentials arrive on stdin and never appear in argv, output or receipts.
package main

import (
 "encoding/base64"
 "encoding/json"
 "fmt"
 "net"
 "os"
 "strings"
 "time"
 mt "github.com/HimbeerserverDE/mt"
 "github.com/HimbeerserverDE/srp"
)

type Input struct { Port int; Username, Password, Command, Button string; Fixture bool }
func fail() { fmt.Fprintln(os.Stderr, "NATIVE_TEST_FAILED"); os.Exit(2) }
func main() {
 var in Input
 if json.NewDecoder(os.Stdin).Decode(&in)!=nil { fail() }
 if in.Fixture {
  salt,verifier,e:=srp.NewClient([]byte(strings.ToLower(in.Username)),[]byte(in.Password));if e!=nil{fail()}
  fmt.Print("#1#"+base64.RawStdEncoding.EncodeToString(salt)+"#"+base64.RawStdEncoding.EncodeToString(verifier));return
 }
 timer:=time.AfterFunc(15*time.Second, fail); defer timer.Stop()
 c,e:=net.Dial("udp",fmt.Sprintf("127.0.0.1:%d",in.Port)); if e!=nil {fail()}
 p:=mt.Connect(c); defer p.Close()
 send:=func(c mt.Cmd) {if _,e:=p.SendCmd(c);e!=nil{fail()}}
 send(&mt.ToSrvNil{})
 send(&mt.ToSrvInit{SerializeVer:29,MinProtoVer:53,MaxProtoVer:53,PlayerName:in.Username})
 var A,a []byte
 authenticated,ready,submitted:=false,false,false
 for {
  pkt,e:=p.Recv();if e!=nil{fail()}
  switch cmd:=pkt.Cmd.(type) {
  case *mt.ToCltHello:
   if cmd.AuthMethods&mt.SRP==0{fail()}
   A,a,e=srp.InitiateHandshake();if e!=nil{fail()}
   send(&mt.ToSrvSRPBytesA{A:A,NoSHA1:true})
  case *mt.ToCltSRPBytesSaltB:
   K,e:=srp.CompleteHandshake(A,a,[]byte(strings.ToLower(in.Username)),[]byte(in.Password),cmd.Salt,cmd.B);if e!=nil{fail()}
   send(&mt.ToSrvSRPBytesM{M:srp.ClientProof([]byte(in.Username),cmd.Salt,A,cmd.B,K)})
  case *mt.ToCltAcceptAuth:
   authenticated=true;send(&mt.ToSrvInit2{Lang:"en"})
  case *mt.ToCltCSMRestrictionFlags:
   if !authenticated{fail()}
   if !ready {ready=true;send(&mt.ToSrvCltReady{Major:5,Minor:17,Patch:0,Version:"HanaWorlds component fixture client",Formspec:4});send(&mt.ToSrvChatMsg{Msg:in.Command})}
  case *mt.ToCltShowFormspec:
   if in.Button=="" || cmd.Formname!="hanaworlds:auto" {continue}
   if !submitted {
    if !strings.Contains(cmd.Formspec,";"+in.Button+";"){fail()}
    send(&mt.ToSrvInvFields{Formname:cmd.Formname,Fields:[]mt.Field{{Name:in.Button,Value:"true"}}});submitted=true
   } else {
    opposite:="hw_auto_disable";if in.Button=="hw_auto_disable"{opposite="hw_auto_enable"}
    if !strings.Contains(cmd.Formspec,";"+opposite+";"){fail()}
    json.NewEncoder(os.Stdout).Encode(map[string]any{"nativeSrp":true,"nativeFormSubmitted":in.Button,"statusChanged":true});return
   }
  case *mt.ToCltChatMsg:
   if in.Button=="" && (strings.Contains(cmd.Text,"privileges") || strings.Contains(cmd.Text,"Privileges")) {
    json.NewEncoder(os.Stdout).Encode(map[string]any{"nativeSrp":true,"nativeCommandAcknowledged":true});return
   }
  case *mt.ToCltKick: fail()
  }
 }
}
