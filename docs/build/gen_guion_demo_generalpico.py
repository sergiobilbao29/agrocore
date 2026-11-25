# -*- coding: utf-8 -*-
"""Guion de Demostracion para prospecto de General Pico (La Pampa).
Enfoque: ganaderia + finanzas integradas en un solo sistema (estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Guion-Demo-General-Pico-Finanzas-Ganaderia.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=5, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11, textColor=G900, spaceBefore=7, spaceAfter=3, leading=14)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=15)
st_say   = S("say", fontName="Helvetica-Oblique", fontSize=10.5, textColor=BLUE_TX, leading=15)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=14, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=14)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=14.5, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),bg),
        ("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7),
    ]))
    return t

def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2,
    )

def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=1, spaceAfter=1,
    )

def say(text):
    return Paragraph("&#128172; <b>Deci:</b> &ldquo;%s&rdquo;" % text, st_say)

def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try:
        canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm,
                         preserveAspectRatio=True, mask='auto')
    except Exception:
        pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13)
    canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 9.5)
    canvas.drawRightString(w-15*mm, h-15*mm, "Guion de demostracion")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6)
    canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []

    E.append(Paragraph("Guion de demostracion", st_title))
    E.append(Paragraph("Prospecto de General Pico (La Pampa) &mdash; ganaderia + finanzas en un solo sistema", st_sub))
    E.append(Paragraph(
        "El cliente hace <b>ganaderia</b> (poca agricultura). A el le interesa la <b>parte contable y financiera</b>: "
        "conciliaciones bancarias, control de cheques y flujo de caja. La ganaderia la maneja su <b>hermano "
        "(ingeniero agronomo)</b>. Ya vio varios sistemas ganaderos, todos parecidos, pero <b>ninguno le sumaba las "
        "finanzas en el mismo lugar</b>. Ese es exactamente nuestro diferencial: <b>todo junto, un solo sistema, "
        "sin tener que usar dos.</b>", st_intro))
    E.append(callout("<b>Tu objetivo manana:</b> que se vaya con esta frase en la cabeza &mdash; "
                     "&ldquo;<b>es el unico que me hace la ganaderia y la parte financiera en el mismo sistema</b>&rdquo;. "
                     "Arranca por lo financiero (lo que a el le duele) y recien despues mostra la ganaderia.",
                     G100, G600, G900))
    E.append(Spacer(1, 3))

    E.append(Paragraph("Antes de empezar (5 min de preparacion)", st_h2))
    E.append(bullets([
        "Entra al sistema con una <b>empresa ganadera de demo</b> con datos cargados (cuentas de banco, cheques, hacienda).",
        "Teni a mano un <b>PDF de resumen bancario</b> y un par de <b>cheques</b> de ejemplo para cargar en vivo.",
        "Prepara <b>2 empresas</b> distintas para mostrar el multiempresa (por ej. dos sociedades / campos).",
        "Duracion ideal: <b>30 a 40 minutos</b>. Deja los ultimos 10 para preguntas y cierre.",
    ]))
    E.append(callout("<b>Regla de oro:</b> mostra <b>el circuito completo</b>, no pantallas sueltas. "
                     "Que vea que un dato se carga una vez y aparece solo en el banco, en el cheque y en el flujo de caja.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # BLOQUE 1
    E.append(Paragraph("Bloque 1 &nbsp;&mdash;&nbsp; El gancho: &ldquo;todo junto&rdquo; (2 min)", st_h2))
    E.append(steps([
        "Abri el sistema en el <b>panel de inicio</b> y mostra el <b>menu completo</b> de un vistazo.",
        "Seniala con el dedo: aca esta la <b>ganaderia</b> (rodeos, hacienda, guias) y aca al lado las <b>finanzas</b> (bancos, cheques, flujo de fondos) &mdash; <b>en la misma pantalla</b>.",
        "Mostra arriba el <b>selector de empresa</b>: el sistema es <b>multiempresa</b>.",
    ]))
    E.append(say("Todo lo que viste en otros sistemas ganaderos, aca esta &mdash; pero ademas tenes toda la parte "
                 "financiera integrada. No vas a necesitar un segundo programa para el banco y los cheques."))

    # BLOQUE 2 - FINANZAS
    E.append(Paragraph("Bloque 2 &nbsp;&mdash;&nbsp; Finanzas (el corazon de la demo, 15 min)", st_h2))
    E.append(Paragraph("Este es el bloque que a EL le interesa. Tomate tu tiempo aca.", st_intro))

    E.append(Paragraph("2.1 &nbsp; Conciliacion bancaria", st_h3))
    E.append(steps([
        "Entra a <b>Bancos</b> y abri una cuenta. Mostra la lista de movimientos con el <b>saldo despues de cada uno</b>.",
        "Toca <b>Importar resumen</b> y subi el PDF (o Excel/CSV, o hasta una <b>foto</b>) del banco.",
        "Mostra que el sistema <b>verifica que el resumen sea de esa cuenta</b> (aviso verde) y arma la <b>vista previa</b>.",
        "Importa los movimientos y entra a <b>Conciliacion bancaria</b>: elegis cuenta y mes, y el sistema cruza lo del banco con lo cargado.",
        "Mostra como se <b>tildan/machean</b> los movimientos y como queda el <b>mes conciliado y bloqueado</b>.",
    ]))
    E.append(say("El resumen lo subis del PDF del banco, o incluso una foto, y el sistema te lo concilia. "
                 "Cuando cerras el mes, queda bloqueado para que nadie lo toque."))

    E.append(Paragraph("2.2 &nbsp; Control de cheques (propios y de terceros)", st_h3))
    E.append(steps([
        "Entra a <b>Cheques</b>. Mostra que estan separados en <b>propios</b> y <b>de terceros</b>, con sus <b>filtros</b> (banco, cuenta, numero, tipo).",
        "Explica los <b>estados</b>: en cartera, <b>depositado (en transito)</b>, <b>cobrado</b> (recien ahi acredita) y <b>rechazado</b>.",
        "Mostra que un cheque de tercero se puede <b>depositar en una cuenta</b>, <b>endosar/entregar</b> a un proveedor o <b>transferir a otra empresa</b>.",
        "Mostra el <b>aviso del calendario</b> a los dias del cheque para revisar pago o rechazo, y el <b>export a PDF</b> de la cartera.",
    ]))
    E.append(say("Vas a tener la cartera de cheques al dia: que tenes, en que banco, cuando vencen y en que estado esta cada uno. "
                 "Nada de planillas de Excel sueltas."))

    E.append(Paragraph("2.3 &nbsp; Flujo de caja / Flujo de fondos", st_h3))
    E.append(steps([
        "Entra a <b>Flujo de fondos</b>. Mostra el <b>detalle cronologico</b> de ingresos y egresos por empresa.",
        "Mostra que trae <b>cheques, cuotas de creditos, arrendamientos y cuentas a cobrar/pagar</b> proyectadas &mdash; no solo lo que ya paso.",
        "Filtra por fecha y <b>exporta a Excel</b>.",
        "Cerra con el <b>Balance general</b> (ingresos/egresos por categoria) y el <b>resumen multiempresa</b> que suma todo.",
    ]))
    E.append(say("Aca ves la pelicula completa de la plata: lo que entro, lo que salio y lo que va a pasar con los "
                 "cheques y las cuotas. Y lo podes ver por empresa o todo junto."))

    E.append(callout("<b>Momento clave:</b> despues de este bloque, para y preguntale &mdash; "
                     "&ldquo;esto es lo que estabas buscando, no?&rdquo;. Deja que asienta el diferencial antes de seguir.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # BLOQUE 3 - GANADERIA
    E.append(Paragraph("Bloque 3 &nbsp;&mdash;&nbsp; Ganaderia (para el hermano agronomo, 8 min)", st_h2))
    E.append(steps([
        "Entra a <b>Rodeos y hacienda</b>. Mostra el <b>stock de hacienda</b> por categoria y campo, y los <b>movimientos</b> (nacimientos, compras, ventas, cambios de categoria).",
        "Abri un <b>rodeo de engorde/cria</b> y mostra el <b>costo por kilo</b> (consumo de pastura/racion imputado al rodeo).",
        "Mostra <b>Guias de hacienda (DT-e)</b>: se cargan de foto/PDF, actualizan stock y dejan la cuenta a cobrar/pagar.",
        "Mostra <b>Liquidaciones de hacienda</b> importadas por PDF (real + SENASA + cuenta corriente).",
    ]))
    E.append(say("Esta parte la va a manejar tu hermano. Es tan completa como los sistemas que ya vieron &mdash; "
                 "pero mira lo que pasa cuando el vende un lote..."))

    E.append(Paragraph("3.1 &nbsp; El puente ganaderia -> finanzas (el 'todo junto' en accion)", st_h3))
    E.append(bullets([
        "Una <b>venta de hacienda / guia / liquidacion</b> genera sola la <b>cuenta a cobrar</b>.",
        "Cuando entra el pago (cheque, transferencia, efectivo), impacta en el <b>banco</b> y en el <b>flujo de caja</b>.",
        "El cheque que recibiste queda en la <b>cartera de cheques</b> con su estado.",
        "<b>Todo desde un solo dato cargado una vez</b> &mdash; sin recargar nada en otro sistema.",
    ]))
    E.append(callout("<b>Este es EL argumento de venta.</b> Mostra en vivo como una venta ganadera aparece "
                     "automaticamente en el flujo de caja y en la cartera de cheques. Ahi se ve por que no necesita dos sistemas.",
                     G100, G600, G900))

    # BLOQUE 4 - MULTIEMPRESA
    E.append(Paragraph("Bloque 4 &nbsp;&mdash;&nbsp; Multiempresa y permisos (3 min)", st_h2))
    E.append(steps([
        "Cambia de empresa con el <b>selector de arriba</b>: cada sociedad/campo con su contabilidad separada, y un <b>resumen que las suma</b>.",
        "Entra a <b>Usuarios y roles</b>: mostra que a <b>vos</b> te podes dar acceso a <b>finanzas</b> y a tu <b>hermano</b> solo a <b>ganaderia</b>.",
        "Explica que cada usuario ve solo lo suyo (permisos por modulo).",
    ]))
    E.append(say("Vos entras y ves la parte financiera; tu hermano entra y ve la ganaderia. Cada uno lo suyo, "
                 "pero los datos son los mismos y se cruzan solos."))

    # BLOQUE 5 - CIERRE
    E.append(Paragraph("Bloque 5 &nbsp;&mdash;&nbsp; Cierre y proximo paso (5 min)", st_h2))
    E.append(bullets([
        "Resumi los <b>3 diferenciales</b>: (1) finanzas + ganaderia en un solo sistema, (2) multiempresa con permisos por persona, (3) importa de PDF/foto (banco, guias, liquidaciones).",
        "Ofrece la <b>prueba gratis 30 dias</b>: <b>agrocore.ar/prueba</b> &mdash; sin tarjeta, sin instalacion.",
        "Proponi cargar <b>sus datos reales</b> (un resumen del banco y algo de hacienda) para que lo pruebe con lo suyo.",
        "Deja agendada una <b>segunda llamada</b> para acompaniar la puesta en marcha.",
    ]))
    E.append(say("Te dejo una prueba de 30 dias sin costo. Metele el resumen de tu banco y algo de hacienda, y en "
                 "un rato lo ves funcionando con tus propios numeros. La semana que viene lo repasamos juntos."))

    # OBJECIONES
    E.append(Paragraph("Objeciones probables y como responder", st_h2))
    faqs = [
        ("&ldquo;Ya vi sistemas de ganaderia muy completos.&rdquo;",
         "Perfecto, la ganaderia aca esta a la altura. La diferencia es que a eso le sumas banco, cheques y flujo de caja en el mismo lugar &mdash; y se cruzan solos. No pagas ni aprendes dos sistemas."),
        ("&ldquo;La parte contable la lleva mi contador.&rdquo;",
         "Ideal: el sistema tiene un hub de exportacion para el contador (Libro IVA digital, retenciones, etc.). Vos manejas el dia a dia y el banco; el contador recibe todo ordenado."),
        ("&ldquo;Es complicado de cargar / migrar.&rdquo;",
         "Importas de PDF o foto: resumen del banco, guias y liquidaciones de hacienda. Y te acompaniamos en la puesta en marcha con los datos reales."),
        ("&ldquo;Cuanto sale?&rdquo;",
         "Primero deja que lo pruebe 30 dias gratis con sus datos. El valor se entiende solo cuando ve que reemplaza dos sistemas y las planillas de Excel."),
        ("&ldquo;Y si se me cae internet en el campo?&rdquo;",
         "Se usa desde la oficina, el campo y el celular; y hay opcion de servidor propio del cliente con backups automaticos."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q))
        E.append(Paragraph(a, st_faq_a))

    E.append(Spacer(1, 6))
    E.append(callout("<b>Frase de cierre:</b> &ldquo;No te vendo un sistema ganadero mas. Te doy el unico que te ordena "
                     "la hacienda <b>y</b> la plata en el mismo lugar &mdash; vos las finanzas, tu hermano el campo, y "
                     "todo conversando solo.&rdquo;", G100, G600, G900))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
