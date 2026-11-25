# -*- coding: utf-8 -*-
"""Instructivo paso a paso: cargar los certificados de ARCA en AgroCore para facturar."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem, Image)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Certificados-ARCA-Facturacion.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "arca_img")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
INDIGO_BG = colors.HexColor("#eef2ff"); INDIGO_BD = colors.HexColor("#818cf8"); INDIGO_TX = colors.HexColor("#3730a3")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569"); CARD_BD = colors.HexColor("#cbd5e1")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=14, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_cap   = S("cap", fontName="Helvetica-Oblique", fontSize=8.5, textColor=SLATE, leading=11, spaceBefore=3, spaceAfter=2, alignment=1)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

CONTENT_W = 180*mm  # ancho útil (A4 - márgenes de 15mm)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items, start=1):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=start+i, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def shot(fname, caption, maxw=150*mm):
    """Imagen (captura) centrada, con marco fino y epígrafe. Escala por ancho."""
    path = os.path.join(IMG, fname)
    iw, ih = ImageReader(path).getSize()
    w = min(maxw, CONTENT_W)
    h = w * ih / iw
    im = Image(path, width=w, height=h)
    inner = Table([[im]], colWidths=[w])
    inner.setStyle(TableStyle([("BOX",(0,0),(-1,-1),0.8,CARD_BD),
        ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
    wrap = Table([[inner],[Paragraph(caption, st_cap)]], colWidths=[CONTENT_W])
    wrap.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),2),
        ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0)]))
    return wrap

def falta_captura(txt):
    p = Paragraph("📸 <b>Captura pendiente:</b> " + txt, S("fc", fontName="Helvetica", fontSize=9.5, leading=13, textColor=SLATE))
    t = Table([[p]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f8fafc")),
        ("BOX",(0,0),(-1,-1),0.8,CARD_BD),("LINEBELOW",(0,0),(-1,-1),0,CARD_BD),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Certificados ARCA")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Certificados de ARCA para facturar con AgroCore", st_title))
    E.append(Paragraph("Generar la clave y el certificado, registrarlos en ARCA, habilitar los servicios y cargarlos en AgroCore", st_sub))
    E.append(Paragraph(
        "Para que AgroCore pueda <b>facturar electrónicamente (sacar CAE)</b> y <b>verificar Cartas de Porte de granos</b> contra "
        "ARCA, necesita un <b>certificado digital</b> emitido por ARCA a tu nombre (o al de la empresa). Es un trámite que se hace "
        "<b>una sola vez</b> por empresa y por ambiente. Lo hacés en tres lugares: generás los archivos en <b>AgroCore</b>, los "
        "registrás y habilitás en el <b>portal de ARCA</b> (con Clave Fiscal), y después volvés a AgroCore a <b>cargarlos</b>.", st_intro))
    E.append(callout("<b>Antes de empezar necesitás:</b> tu <b>CUIT</b> y <b>Clave Fiscal</b> (nivel 3 o superior), y tener claro el "
                     "<b>ambiente</b>: <b>Producción</b> (facturás de verdad) u <b>Homologación</b> (pruebas). <b>Cada ambiente usa "
                     "su propio certificado</b>: el de homologación NO sirve en producción y viceversa.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 1
    E.append(Paragraph("Paso 1 — En AgroCore: elegir ambiente y generar la clave + el pedido de certificado", st_h2))
    E.append(steps([
        "Entrá a <b>Administración → Configuración</b> y abrí la pestaña <b>🏦 ARCA</b>.",
        "En <b>Ambiente de AFIP</b> elegí <b>Producción</b> (o Homologación si vas a probar).",
        "En <b>Paso 1</b> escribí tu <b>Nombre / Razón social</b> y tu <b>CUIT (sin guiones)</b> y tocá <b>⚙️ Generar archivos</b>.",
        "AgroCore crea solo dos archivos y te los descarga: la <b>clave privada</b> (<b>privada.key</b>) y la <b>solicitud</b> "
        "(<b>solicitud.csr</b>). La clave privada es <b>secreta</b>: no la compartas con nadie.",
    ]))
    E.append(shot("01_agrocore_arca.png", "Configuración → ARCA. Elegís el ambiente, completás nombre y CUIT, y tocás “Generar archivos”."))
    E.append(callout("Si ya tenés un archivo <b>.p12</b> o <b>.pfx</b> de ARCA, podés saltear este paso y cargarlo directamente en el "
                     "Paso 5 (hay que separarlo en .crt y .key; en la misma pantalla de AgroCore está el comando de OpenSSL para hacerlo).",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 2
    E.append(Paragraph("Paso 2 — Entrar al portal de ARCA con Clave Fiscal", st_h2))
    E.append(steps([
        "Entrá a <b>auth.afip.gob.ar</b> (para Producción) e ingresá con tu <b>CUIT y Clave Fiscal</b>.",
        "Importante: registrá el certificado en el <b>portal del ambiente que elegiste</b> en el Paso 1. Cada ambiente tiene su propio portal.",
    ]))
    E.append(shot("02_afip_login.png", "Ingreso a ARCA con Clave Fiscal (auth.afip.gob.ar).", maxw=95*mm))

    # PASO 3
    E.append(Paragraph("Paso 3 — Registrar el certificado en “Administración de Certificados Digitales”", st_h2))
    E.append(steps([
        "Dentro del portal, buscá y entrá al servicio <b>Administración de Certificados Digitales</b>.",
        "Tocá <b>Agregar alias</b>.",
        "Poné un <b>alias</b> (ej. <b>agrocore</b>) y en <b>Seleccionar archivo</b> subí el <b>solicitud.csr</b> que te dio AgroCore. "
        "Confirmá con <b>Agregar alias</b>.",
        "Entrá al alias (<b>Ver</b>) y <b>descargá el certificado</b> generado (el archivo <b>.crt</b>).",
    ]))
    E.append(shot("03_cert_lista.png", "Administración de Certificados Digitales → “Agregar alias”.", maxw=150*mm))
    E.append(shot("04_cert_agregar.png", "Cargás el alias (ej. “Agrocore”) y subís el archivo solicitud.csr.", maxw=150*mm))
    E.append(shot("05_cert_detalle.png", "Detalle del certificado emitido. Desde acá lo descargás con el ícono de la columna “Descargar”.", maxw=150*mm))
    E.append(Paragraph("Al final te tienen que quedar <b>tres archivos</b> en Descargas: el <b>.crt</b> (certificado, lo bajaste de ARCA), "
                       "y la <b>privada.key</b> y la <b>solicitud.csr</b> (los generó AgroCore en el Paso 1).", st_intro))
    E.append(shot("06_descargas.png", "Los tres archivos. Para AgroCore vas a usar el .crt y la privada.key.", maxw=80*mm))

    # PASO 4 — EL QUE NO ESTABA CLARO
    E.append(Paragraph("Paso 4 — Habilitar los servicios (acá se aclara el punto 5) ⭐", st_h2))
    E.append(callout("<b>Esto NO se hace en “Administración de Certificados Digitales”.</b> Se hace en otro servicio del mismo portal de "
                     "ARCA llamado <b>“Administrador de Relaciones de Clave Fiscal”</b>. Ahí le decís a ARCA que tu certificado "
                     "(que figura como <b>Computador Fiscal</b>) puede usar los servicios de facturación y de granos.",
                     RED_BG, RED_BD, RED_TX))
    E.append(steps([
        "En el portal de ARCA, entrá al servicio <b>Administrador de Relaciones de Clave Fiscal</b> (es distinto al de certificados).",
        "Tocá <b>Nueva Relación</b> (o <b>Adherir Servicio</b>) y, en <b>Servicio</b>, tocá <b>Buscar</b>.",
        "Navegá el listado de organismos hasta <b>ARCA → WebServices</b>.",
        "Elegí el servicio que necesitás: <b>“Facturación Electrónica”</b> (wsfe) para sacar CAE, y para las Cartas de Porte de "
        "granos <b>“Carta de Porte Electrónica” (wscpe)</b> o <b>“Código de Trazabilidad de Granos” (wsctg)</b> según corresponda. "
        "Es un servicio por vez: repetís el circuito para cada uno.",
        "En <b>Representante</b> tocá <b>Buscar</b> y seleccioná tu <b>Computador Fiscal</b>: es el <b>alias/certificado</b> que creaste "
        "en el Paso 3 (aparece como “AgroCore”).",
        "Tocá <b>Confirmar</b>. ARCA muestra el <b>formulario F.3283/E</b> con la autorización otorgada. Repetí para el otro servicio.",
    ]))
    E.append(shot("08_adminrel_orgs.png", "Administrador de Relaciones → Nueva Relación → Buscar servicio: listado de organismos. Entrá a ARCA → WebServices.", maxw=150*mm))
    E.append(shot("09_adminrel_servicios.png", "Dentro de WebServices, elegí “Facturación Electrónica” (y después el de granos).", maxw=150*mm))
    E.append(shot("10_adminrel_wsfe.png", "Incorporar nueva Relación: Servicio = Facturación Electrónica, Representante = Computador Fiscal “AgroCore”. Tocá CONFIRMAR.", maxw=155*mm))
    E.append(shot("11_f3283_wsfe.png", "Confirmación (F.3283/E) de la autorización de Facturación Electrónica al Computador Fiscal.", maxw=155*mm))
    E.append(shot("12_adminrel_wscpe.png", "Mismo circuito para la Carta de Porte de granos (acá, servicio wscpe) con el mismo Computador Fiscal.", maxw=155*mm))
    E.append(shot("13_f3283_wscpe.png", "Confirmación (F.3283/E) de la autorización del servicio de granos.", maxw=155*mm))

    # PASO 5
    E.append(Paragraph("Paso 5 — Volver a AgroCore y cargar el certificado", st_h2))
    E.append(steps([
        "Volvé a <b>Configuración → ARCA</b> en AgroCore, al <b>Paso 3</b> de esa pantalla (“Cargar el certificado”).",
        "Subí el <b>cert.crt</b> (el que bajaste de ARCA) y la <b>privada.key</b> (la que generó AgroCore) en sus casilleros.",
        "Confirmá que el <b>CUIT</b> y el <b>ambiente</b> sean los correctos y <b>guardá</b>.",
        "Arriba, el <b>Estado de integración ARCA</b> debería pasar de “pendiente” a <b>Certificado ✓ / Clave ✓ / CUIT ✓</b>.",
    ]))
    E.append(shot("14_agrocore_faltan.png", "Paso 3 en AgroCore: subís cert.crt y privada.key y completás el CUIT. Cuando quedan cargados, muestran “✓ YA CARGADO”.", maxw=150*mm))
    E.append(callout("Con <b>Guardar configuración</b> dejás los archivos cargados. <b>Probar conexión ARCA</b> confirma que el certificado "
                     "está bien y que el servidor llega a ARCA (ver la sección de problemas si da error).", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 6 — Punto de Venta Web Services
    E.append(Paragraph("Paso 6 — Crear el Punto de Venta “Web Services” en ARCA", st_h2))
    E.append(Paragraph("Para que AgroCore facture solo (por web service) ARCA exige un <b>punto de venta del tipo Web Services</b>. "
                       "El punto de venta de <b>“Comprobantes en línea”</b> (el que usás para facturar a mano en la web de ARCA) "
                       "<b>no sirve</b> para esto, y ARCA no permite usar el mismo número para los dos: hay que <b>crear uno nuevo</b>.", st_intro))
    E.append(steps([
        "En ARCA, con tu clave fiscal, entrá al servicio <b>“Administración de puntos de venta y domicilios”</b>.",
        "Elegí tu empresa (CUIT) y entrá a <b>“A/B/M de puntos de venta”</b>.",
        "Tocá el botón <b>Agregar</b> (el “+” arriba a la derecha).",
        "En <b>Sistema</b> elegí la opción de Web Services: <b>“Factura Electrónica - Monotributo - Web Services”</b> si sos Monotributo, "
        "o <b>“RECE / Factura Electrónica - Web Services”</b> si sos Responsable Inscripto. Completá Nombre de Fantasía, Dominio y Domicilio.",
        "Confirmá con <b>Aceptar</b>. ARCA te asigna un <b>número nuevo</b> de punto de venta (por ej. <b>00003</b>). <b>Anotalo.</b>",
        "En AgroCore, al emitir la factura, usá <b>ese número</b> de punto de venta (el de Web Services), no el de “Comprobantes en línea”.",
    ]))
    E.append(falta_captura("Capturas de ARCA → “A/B/M de puntos de venta”: el alta del punto de venta Web Services y el listado "
                           "mostrando el nuevo punto (ej. 00003 - Factura Electrónica Web Services)."))
    E.append(callout("Si al emitir te aparece el error <b>[10005] “NO AUTORIZADO A EMITIR... EL PUNTO DE VENTA DEBE SER DEL TIPO RECE”</b>, "
                     "es exactamente esto: ese punto de venta no está dado de alta como Web Services. Creá el punto de venta Web Services "
                     "siguiendo este paso y usá el número nuevo.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 7
    E.append(Paragraph("Paso 7 — Probar y facturar", st_h2))
    E.append(bullets([
        "Emití una <b>factura de venta</b> desde AgroCore: si todo está bien, ARCA devuelve el <b>CAE</b> y la factura queda autorizada.",
        "Para granos, al cargar un viaje / Carta de Porte, AgroCore puede <b>verificarla</b> contra ARCA (WSCTG).",
        "Si algo falla, casi siempre es: <b>ambiente cruzado</b> (cert de homologación en producción), el <b>servicio no adherido</b> "
        "(Paso 4), o el <b>CUIT</b> no coincide con el del certificado.",
    ]))

    # Solución de problemas
    E.append(Paragraph("Solución de problemas", st_h2))
    E.append(shot("15_agrocore_error.png", "Ejemplo: el certificado y la clave están “✓ YA CARGADO”, pero “Probar conexión” da un error de WSFE.", maxw=150*mm))
    E.append(Paragraph("<b>“No se pudo conectar a WSFE: fetch failed” (o WSAA):</b>", st_intro))
    E.append(bullets([
        "<b>No es un problema del certificado ni de los archivos.</b> Si el certificado estuviera mal, fallaría el login (WSAA). "
        "Este error es de <b>red</b>: el servidor donde corre AgroCore no está llegando al servidor de ARCA.",
        "Causas típicas: AFIP/ARCA <b>momentáneamente caído</b> (reintentá en un rato), el servidor <b>sin salida a internet</b> "
        "hacia los dominios de ARCA (<i>servicios1.afip.gov.ar</i>, <i>wsaa.afip.gov.ar</i>), o un <b>firewall</b> que bloquea la salida.",
        "AgroCore ahora muestra el <b>motivo exacto</b> entre corchetes (ej. <i>[ENOTFOUND]</i> = DNS, <i>[ETIMEDOUT]</i> = firewall/"
        "sin salida, <i>[ECONNREFUSED]</i> = conexión rechazada). Ese código le dice al técnico qué habilitar en el servidor.",
        "Si <b>Probar conexión</b> da OK en <b>Homologación</b> pero falla en <b>Producción</b> (o al revés), revisá que el <b>certificado "
        "sea del mismo ambiente</b> y que el servicio esté <b>adherido</b> (Paso 4).",
    ]))
    E.append(callout("Importante: <b>Guardar configuración</b> igual deja los archivos cargados aunque “Probar conexión” falle por red. "
                     "Cuando se destrabe la salida hacia ARCA, probá de nuevo sin volver a cargar nada.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Por qué el punto que decía “volvé al portal y asociá el alias a los servicios” no me quedaba claro?",
         "Porque esa asociación NO está en “Administración de Certificados Digitales” (donde creaste el alias), sino en otro "
         "servicio: “Administrador de Relaciones de Clave Fiscal”. Ahí adherís WSFE y WSCTG y ponés tu certificado como representante "
         "(Computador Fiscal). Es el Paso 4 de este instructivo."),
        ("¿Qué es un “Computador Fiscal”?",
         "Es como ARCA llama a tu certificado/alias cuando lo usás para que un sistema (AgroCore) opere en tu nombre. Al adherir un "
         "servicio, elegís ese computador fiscal como “representante”."),
        ("¿WSFE y WSCTG son dos trámites distintos?",
         "Sí. En el Administrador de Relaciones se adhiere un servicio por vez. Hacé WSFE (facturación) y WSCTG (granos) por separado, "
         "los dos con el mismo certificado."),
        ("¿Tengo que instalar OpenSSL?",
         "No, si generás los archivos desde AgroCore (Paso 1). Solo lo necesitás si tenés un .p12/.pfx y querés separarlo en .crt y .key; "
         "el comando está en la misma pantalla de ARCA de AgroCore."),
        ("¿El certificado vence?",
         "Sí, tiene fecha de vencimiento (lo ves en el detalle del certificado en ARCA). Cuando se acerque, se renueva repitiendo el "
         "circuito y se vuelve a cargar en AgroCore."),
        ("¿La clave privada es peligroso compartirla?",
         "Sí. La privada.key es secreta: no la mandes por mail ni la subas a ningún lado. Solo se carga en AgroCore."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
